// espmatter studio – Matter controller: firmware updates of paired devices (Matter OTA). The hub is
// the OTA provider of its fabric (root endpoint, served by esp-matter's controller):
//   - a device of the app (BasicInformation UniqueID = its id in the app) gets the build released
//     for it, asked for at the app with the hub's token,
//   - any other device gets what its maker publishes in the CSA's registry (DCL).
// The image is streamed over BDX while it downloads, one device at a time. The hub also makes
// itself every device's default provider and can ask one to check now.
#include "espm.h"
#include "espm_controller.h"

#include <inttypes.h>
#include <string.h>
#include <algorithm>
#include <atomic>
#include <string>
#include <vector>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>
#include <freertos/task.h>
#include <app-common/zap-generated/cluster-objects.h>
#include <app/CommandHandler.h>
#include <app/WriteClient.h>
#include <app/clusters/ota-provider/ota-provider-delegate.h>
#include <controller/CHIPDeviceControllerFactory.h>
#include <crypto/RandUtils.h>
#include <platform/CHIPDeviceLayer.h>
#include <protocols/bdx/BdxUri.h>
#include <protocols/bdx/TransferFacilitator.h>
#include <controller_data_model_provider.h>
#include <esp_matter_controller_client.h>
#include <esp_matter_controller_cluster_command.h>

using namespace chip;
using namespace chip::app;
using namespace chip::app::Clusters;
using namespace chip::app::Clusters::OtaSoftwareUpdateProvider;
using chip::bdx::TransferControlFlags;
using chip::bdx::TransferSession;
using chip::Protocols::InteractionModel::Status;
using esp_matter::controller::matter_controller_client;
using Location = OtaSoftwareUpdateRequestor::Structs::ProviderLocation::Type;

static const char *TAG = "espm_ota_prov";

static constexpr uint16_t kBlockSize = 1024;
static constexpr auto kBdxTimeout = System::Clock::Seconds16(5 * 60); // the spec asks for ≥ 5 min
static constexpr auto kBdxPoll = System::Clock::Milliseconds32(50);
static constexpr uint32_t kBusyRetryS = 120;
static const char *DCL = "https://on.dcl.csa-iot.org/dcl/model/versions";

static auto *commissioner() { return matter_controller_client::get_instance().get_commissioner(); }

/** An update for a device, found by a lookup. */
struct Candidate {
    bool found;
    bool from_app; // download with the hub's token
    uint32_t version;
    char version_string[65];
    char url[256];
};

// ---------------------------------------------------------------------------------------------
// HTTP helpers (lookup and download tasks)
// ---------------------------------------------------------------------------------------------

static esp_http_client_handle_t http_open(const char *url, bool with_token, int64_t *length)
{
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.timeout_ms = 20000;
    cfg.buffer_size = 2048;
    cfg.keep_alive_enable = true;
    if (strncmp(url, "https://", 8) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) return nullptr;
    if (with_token) {
        std::string bearer = std::string("Bearer ") + ESPM_API_TOKEN;
        esp_http_client_set_header(client, "Authorization", bearer.c_str());
    }
    if (esp_http_client_open(client, 0) == ESP_OK) {
        int64_t len = esp_http_client_fetch_headers(client);
        if (length) *length = len;
        return client;
    }
    esp_http_client_cleanup(client);
    return nullptr;
}

/** GET a JSON document: its status, and the parsed body for 200 (nullptr otherwise). */
static int get_json(const char *url, bool with_token, cJSON **out)
{
    *out = nullptr;
    esp_http_client_handle_t client = http_open(url, with_token, nullptr);
    if (!client) return 0;
    int status = esp_http_client_get_status_code(client);
    if (status == 200) {
        static constexpr int MAX = 4096;
        char *buf = (char *)malloc(MAX);
        int n = buf ? esp_http_client_read_response(client, buf, MAX - 1) : 0;
        if (n > 0) {
            buf[n] = 0;
            *out = cJSON_Parse(buf);
        }
        free(buf);
    }
    esp_http_client_cleanup(client);
    return status;
}

static uint32_t json_u32(cJSON *o, const char *key)
{
    cJSON *v = cJSON_GetObjectItem(o, key);
    return cJSON_IsNumber(v) && v->valuedouble > 0 ? (uint32_t)v->valuedouble : 0;
}

static void found(Candidate &c, bool from_app, uint32_t version, const char *url, cJSON *version_string)
{
    c.found = true;
    c.from_app = from_app;
    c.version = version;
    strlcpy(c.url, url, sizeof(c.url));
    if (cJSON_IsString(version_string)) strlcpy(c.version_string, version_string->valuestring, sizeof(c.version_string));
    else snprintf(c.version_string, sizeof(c.version_string), "%" PRIu32, version);
}

// ---------------------------------------------------------------------------------------------
// Lookups (own task: the Matter task must not wait for HTTP)
// ---------------------------------------------------------------------------------------------

/** 0: no device of the app; 1: asked (`c` says whether there is an update). */
static int lookup_app(const char *uid, uint32_t running, Candidate &c)
{
    if (!ESPM_APP_URL[0] || strlen(uid) != 32) return 0;
    // UniqueID: the app's id without dashes (8-4-4-4-12).
    char id[37];
    snprintf(id, sizeof(id), "%.8s-%.4s-%.4s-%.4s-%.12s", uid, uid + 8, uid + 12, uid + 16, uid + 20);
    char url[256];
    snprintf(url, sizeof(url), "%s/api/v1/devices/%s/update?slot=main&version=%" PRIu32 "&format=matter",
             ESPM_APP_URL, id, running);
    cJSON *json;
    int status = get_json(url, true, &json);
    if (status == 204) return 1;
    if (status != 200 || !json) {
        cJSON_Delete(json);
        // 401/404: not a device of the app (or not one of this hub's) – ask the registry.
        if (status && status != 401 && status != 404)
            ESP_LOGW(TAG, "App answered %d for device %s", status, id);
        return status == 401 || status == 404 || !status ? 0 : 1;
    }
    cJSON *u = cJSON_GetObjectItem(json, "url");
    uint32_t version = json_u32(json, "version");
    if (cJSON_IsString(u) && version && version != running)
        found(c, true, version, u->valuestring, cJSON_GetObjectItem(json, "versionString"));
    cJSON_Delete(json);
    return 1;
}

/** The newest version in the DCL that applies to `running` and has an image. */
static void lookup_dcl(uint16_t vid, uint16_t pid, uint32_t running, Candidate &c)
{
    char url[160];
    snprintf(url, sizeof(url), "%s/%u/%u", DCL, vid, pid);
    cJSON *json;
    if (get_json(url, false, &json) != 200 || !json) {
        cJSON_Delete(json);
        return;
    }
    std::vector<uint32_t> versions;
    cJSON *list = cJSON_GetObjectItem(cJSON_GetObjectItem(json, "modelVersions"), "softwareVersions");
    cJSON *v;
    cJSON_ArrayForEach(v, list)
    if (cJSON_IsNumber(v) && (uint32_t)v->valuedouble > running) versions.push_back((uint32_t)v->valuedouble);
    cJSON_Delete(json);
    std::sort(versions.rbegin(), versions.rend());
    // The newest first; a version without an image or not for this one: the next older.
    for (size_t i = 0; i < versions.size() && i < 3; i++) {
        snprintf(url, sizeof(url), "%s/%u/%u/%" PRIu32, DCL, vid, pid, versions[i]);
        if (get_json(url, false, &json) != 200 || !json) {
            cJSON_Delete(json);
            continue;
        }
        cJSON *m = cJSON_GetObjectItem(json, "modelVersion");
        cJSON *ota = cJSON_GetObjectItem(m, "otaUrl");
        cJSON *valid = cJSON_GetObjectItem(m, "softwareVersionValid");
        uint32_t min = json_u32(m, "minApplicableSoftwareVersion");
        cJSON *max_item = cJSON_GetObjectItem(m, "maxApplicableSoftwareVersion");
        uint32_t max = cJSON_IsNumber(max_item) ? (uint32_t)max_item->valuedouble : UINT32_MAX;
        bool ok = cJSON_IsString(ota) && ota->valuestring[0] && !cJSON_IsFalse(valid) && running >= min &&
                  running <= max;
        if (ok) found(c, false, versions[i], ota->valuestring, cJSON_GetObjectItem(m, "softwareVersionString"));
        cJSON_Delete(json);
        if (ok) return;
    }
}

// ---------------------------------------------------------------------------------------------
// BDX: stream the image to the device while it downloads
// ---------------------------------------------------------------------------------------------

/** Matter OTA image header prefix (file identifier, total size, header size). */
static constexpr uint32_t kOtaFileId = 0x1BEEF11E;

/** Downloaded ahead of the device: a few blocks. */
static constexpr size_t kBuffered = 4 * kBlockSize;

/**
 * A task of its own downloads the image into a small buffer; the transfer (Matter task) takes its
 * blocks from there and answers a block query once enough has arrived – it never waits for HTTP.
 */
class Sender : public bdx::Responder {
public:
    /** Ready a transfer of `c` to `node` and start downloading it; false: one runs. */
    bool Prepare(NodeId node, const Candidate &c)
    {
        if (Active()) return false;
        if (!mBuf) mBuf = xStreamBufferCreate(kBuffered, 1);
        if (!mBuf) return false;
        xStreamBufferReset(mBuf); // no task uses it now
        mNode = node;
        mCandidate = c;
        mSent = 0;
        mTotal = 0;
        mQuery = false;
        mCancel = false;
        mDone = false;
        mFailed = false;
        BitFlags<TransferControlFlags> flags(TransferControlFlags::kReceiverDrive);
        auto *ss = Controller::DeviceControllerFactory::GetInstance().GetSystemState();
        if (PrepareForTransfer(ss->SystemLayer(), bdx::TransferRole::kSender, flags, kBlockSize, kBdxTimeout,
                               kBdxPoll) != CHIP_NO_ERROR)
            return false;
        mDownloading = true;
        if (xTaskCreate(download_task, "espm_ota_dl", 6144, this, 3, nullptr) != pdPASS) {
            mDownloading = false;
            ResetTransfer();
            return false;
        }
        mActive = true;
        return true;
    }
    /** A transfer runs, or the last one's download still winds down. */
    bool Active() const { return mActive || mDownloading; }
    NodeId Node() const { return mNode; }

private:
    static void download_task(void *arg)
    {
        auto *s = static_cast<Sender *>(arg);
        esp_http_client_handle_t http = http_open(s->mCandidate.url, s->mCandidate.from_app, nullptr);
        bool ok = http && esp_http_client_get_status_code(http) == 200;
        while (ok && !s->mCancel) {
            int n = esp_http_client_read(http, (char *)s->mChunk, sizeof(s->mChunk));
            if (n < 0) ok = false;
            if (n <= 0) break;
            for (int off = 0; off < n && !s->mCancel;)
                off += xStreamBufferSend(s->mBuf, s->mChunk + off, n - off, pdMS_TO_TICKS(500));
            s->Wake();
        }
        if (http) esp_http_client_cleanup(http);
        s->mFailed = !ok;
        s->mDone = true;
        s->Wake();
        s->mDownloading = false;
        vTaskDelete(nullptr);
    }

    /** From the download task: let the Matter task look whether a block is ready. */
    void Wake()
    {
        if (mWake.exchange(true)) return;
        DeviceLayer::PlatformMgr().ScheduleWork([](intptr_t self) { reinterpret_cast<Sender *>(self)->TrySend(); },
                                                (intptr_t)this);
    }

    /** Answer the pending block query once a block (or the rest) has arrived. */
    void TrySend()
    {
        mWake = false;
        if (!mActive || !mQuery) return;
        uint16_t want = mTransfer.GetTransferBlockSize();
        bool done = mDone; // before looking at the buffer: all of it is in there then
        if (done && mFailed) return Abort("image download failed");
        if (xStreamBufferBytesAvailable(mBuf) < want && !done) return;
        System::PacketBufferHandle buf = System::PacketBufferHandle::New(want);
        if (buf.IsNull()) return Abort("out of memory");
        size_t got = xStreamBufferReceive(mBuf, buf->Start(), want, 0);
        if (got == 0 && mSent == 0) return Abort("empty image");
        if (mSent == 0) {
            // The first block holds the Matter OTA header: it says how long the image is.
            const uint8_t *p = buf->Start();
            uint32_t id = p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24;
            uint64_t total = 0;
            for (int i = 0; i < 8; i++) total |= (uint64_t)p[4 + i] << (8 * i);
            if (got < 16 || id != kOtaFileId || !total) return Abort("not a Matter OTA image");
            mTotal = total;
        }
        TransferSession::BlockData block;
        block.Data = buf->Start();
        block.Length = (size_t)std::min<uint64_t>((uint64_t)got, mTotal - mSent);
        mSent += block.Length;
        block.IsEof = block.Length < want || mSent >= mTotal;
        mQuery = false;
        if (mTransfer.PrepareBlock(block) != CHIP_NO_ERROR) return Abort("block failed");
    }

    void HandleTransferSessionOutput(TransferSession::OutputEvent &event) override
    {
        switch (event.EventType) {
        case TransferSession::OutputEventType::kMsgToSend: {
            Messaging::SendFlags flags;
            if (!event.msgTypeData.HasMessageType(Protocols::SecureChannel::MsgType::StatusReport))
                flags.Set(Messaging::SendMessageFlags::kExpectResponse);
            if (!mExchangeCtx) return;
            if (mExchangeCtx->SendMessage(event.msgTypeData.ProtocolId, event.msgTypeData.MessageType,
                                          std::move(event.MsgData), flags) != CHIP_NO_ERROR)
                return Reset("send failed");
            if (!flags.Has(Messaging::SendMessageFlags::kExpectResponse)) mExchangeCtx = nullptr;
            break;
        }
        case TransferSession::OutputEventType::kInitReceived: {
            TransferSession::TransferAcceptData accept;
            accept.ControlMode = TransferControlFlags::kReceiverDrive;
            accept.MaxBlockSize = mTransfer.GetTransferBlockSize();
            accept.StartOffset = mTransfer.GetStartOffset();
            accept.Length = mTransfer.GetTransferLength();
            if (mTransfer.AcceptTransfer(accept) != CHIP_NO_ERROR) return Reset("accept failed");
            ESP_LOGI(TAG, "Sending %s to node 0x%llx", mCandidate.version_string, (unsigned long long)mNode);
            break;
        }
        case TransferSession::OutputEventType::kQueryReceived:
            mQuery = true;
            TrySend();
            break;
        case TransferSession::OutputEventType::kAckEOFReceived:
            ESP_LOGI(TAG, "Node 0x%llx has the image (%llu bytes)", (unsigned long long)mNode,
                     (unsigned long long)mSent);
            Reset(nullptr);
            break;
        case TransferSession::OutputEventType::kStatusReceived: Reset("the device stopped the transfer"); break;
        case TransferSession::OutputEventType::kInternalError: Reset("internal error"); break;
        case TransferSession::OutputEventType::kTransferTimeout: Reset("transfer timed out"); break;
        default: break;
        }
    }

    void Abort(const char *why)
    {
        mTransfer.AbortTransfer(bdx::StatusCode::kUnknown);
        Reset(why);
    }

    void Reset(const char *why)
    {
        if (why) ESP_LOGW(TAG, "Update of node 0x%llx: %s", (unsigned long long)mNode, why);
        ResetTransfer();
        if (mExchangeCtx) {
            mExchangeCtx->Close();
            mExchangeCtx = nullptr;
        }
        mCancel = true; // the download task stops and cleans up
        mQuery = false;
        mActive = false;
    }

    bool mActive = false;
    bool mQuery = false; // a block query waits for data
    NodeId mNode = kUndefinedNodeId;
    Candidate mCandidate = {};
    uint64_t mSent = 0, mTotal = 0;
    StreamBufferHandle_t mBuf = nullptr;
    uint8_t mChunk[kBlockSize]; // the download task's
    std::atomic<bool> mDownloading{false}, mCancel{false}, mDone{false}, mFailed{false}, mWake{false};
};
static Sender s_sender;

// ---------------------------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------------------------

/** Per device: the update offered last (for ApplyUpdateRequest) or waiting for approval. */
struct Offer {
    uint64_t node;
    uint32_t version;
    uint8_t token[16];
    char waiting[65]; // version string waiting for approval ("ask" mode)
    bool approved;    // install the next one found
};
static std::vector<Offer> s_offers;

static Offer &offer_of(uint64_t node)
{
    for (auto &o : s_offers)
        if (o.node == node) return o;
    s_offers.push_back(Offer{node, 0, {}, {}, false});
    return s_offers.back();
}

/** The query being answered (one at a time, like the transfer). */
static struct {
    CommandHandler::Handle handle;
    ConcreteCommandPath path{0, 0, 0};
    ScopedNodeId peer;
    uint16_t vid, pid;
    uint32_t running;
    char uid[33];
    Candidate result;
} s_query;
static bool s_querying;

static void respond(intptr_t);

static Commands::QueryImageResponse::Type busy()
{
    Commands::QueryImageResponse::Type response;
    response.status = OTAQueryStatus::kBusy;
    response.delayedActionTime.Emplace(kBusyRetryS);
    return response;
}

static void lookup_task(void *)
{
    Candidate c = {};
    if (!lookup_app(s_query.uid, s_query.running, c)) lookup_dcl(s_query.vid, s_query.pid, s_query.running, c);
    s_query.result = c;
    DeviceLayer::PlatformMgr().ScheduleWork(respond, 0);
    vTaskDelete(nullptr);
}

static void respond(intptr_t)
{
    s_querying = false;
    auto ref = std::move(s_query.handle);
    CommandHandler *handler = ref.Get();
    if (!handler) return;
    const Candidate &c = s_query.result;
    uint64_t node = s_query.peer.GetNodeId();
    Offer &o = offer_of(node);
    Commands::QueryImageResponse::Type response;
    response.status = OTAQueryStatus::kNotAvailable;
    if (c.found && !ESPM_CTRL_OTA_AUTO && !o.approved) {
        // Updates on approval: the hub's list shows it until someone installs it.
        strlcpy(o.waiting, c.version_string, sizeof(o.waiting));
        ESP_LOGI(TAG, "Node 0x%llx: %s waits for approval", (unsigned long long)node, c.version_string);
    } else if (c.found && s_sender.Active()) {
        response = busy();
    } else if (c.found && s_sender.Prepare(node, c)) {
        static char uri[96];
        MutableCharSpan span(uri);
        const char *file = strrchr(c.url, '/');
        if (bdx::MakeURI(commissioner()->GetNodeId(), CharSpan::fromCharString(file && file[1] ? file + 1 : "image.ota"),
                         span) != CHIP_NO_ERROR)
            strlcpy(uri, "bdx://0000000000000000/image.ota", sizeof(uri));
        else uri[span.size() < sizeof(uri) ? span.size() : sizeof(uri) - 1] = 0;
        for (auto &b : o.token) b = Crypto::GetRandU8();
        o.version = c.version;
        o.waiting[0] = 0;
        o.approved = false;
        static char version_string[65];
        strlcpy(version_string, c.version_string, sizeof(version_string));
        response.status = OTAQueryStatus::kUpdateAvailable;
        response.imageURI.Emplace(CharSpan::fromCharString(uri));
        response.softwareVersion.Emplace(c.version);
        response.softwareVersionString.Emplace(CharSpan::fromCharString(version_string));
        response.updateToken.Emplace(ByteSpan(o.token));
        ESP_LOGI(TAG, "Node 0x%llx: update to %s (%s)", (unsigned long long)node, c.version_string,
                 c.from_app ? "app" : "DCL");
    }
    handler->AddResponse(s_query.path, response);
}

class Provider : public OTAProviderDelegate {
    void HandleQueryImage(CommandHandler *handler, const ConcreteCommandPath &path,
                          const Commands::QueryImage::DecodableType &data) override
    {
        if (s_querying) return handler->AddResponse(path, busy());
        // Looking it up takes a while: acknowledge now, answer when the lookup is done.
        handler->FlushAcksRightAwayOnSlowCommand();
        s_query.peer = handler->GetExchangeContext()->GetSessionHandle()->GetPeer();
        s_query.path = path;
        s_query.vid = (uint16_t)data.vendorID;
        s_query.pid = data.productID;
        s_query.running = data.softwareVersion;
        const char *uid = espm_controller_unique_id(s_query.peer.GetNodeId());
        strlcpy(s_query.uid, uid ? uid : "", sizeof(s_query.uid));
        s_query.handle = CommandHandler::Handle(handler);
        s_querying = true;
        ESP_LOGI(TAG, "Node 0x%llx asks for an update (vendor 0x%04x, product 0x%04x, version %" PRIu32 ")",
                 (unsigned long long)s_query.peer.GetNodeId(), s_query.vid, s_query.pid, s_query.running);
        if (xTaskCreate(lookup_task, "espm_ota_look", 6144, nullptr, 3, nullptr) != pdPASS) {
            s_query.result = {};
            respond(0);
        }
    }

    void HandleApplyUpdateRequest(CommandHandler *handler, const ConcreteCommandPath &path,
                                  const Commands::ApplyUpdateRequest::DecodableType &data) override
    {
        Offer &o = offer_of(handler->GetExchangeContext()->GetSessionHandle()->GetPeer().GetNodeId());
        if (!data.updateToken.data_equal(ByteSpan(o.token)) || data.newVersion != o.version)
            return handler->AddStatus(path, Status::InvalidCommand);
        Commands::ApplyUpdateResponse::Type response;
        response.action = OTAApplyUpdateAction::kProceed;
        response.delayedActionTime = 0;
        handler->AddResponse(path, response);
    }

    void HandleNotifyUpdateApplied(CommandHandler *handler, const ConcreteCommandPath &path,
                                   const Commands::NotifyUpdateApplied::DecodableType &data) override
    {
        uint64_t node = handler->GetExchangeContext()->GetSessionHandle()->GetPeer().GetNodeId();
        ESP_LOGI(TAG, "Node 0x%llx runs version %" PRIu32 " now", (unsigned long long)node, data.softwareVersion);
        handler->AddStatus(path, Status::Success);
    }
};
static Provider s_provider;

// ---------------------------------------------------------------------------------------------
// Default provider of every device
// ---------------------------------------------------------------------------------------------

/** Nodes waiting for their default provider, the one being written, and those done since boot. */
static std::vector<uint64_t> s_queue, s_done;
static uint64_t s_writing;

static void next();

class Writer : public WriteClient::Callback {
    void OnResponse(const WriteClient *, const ConcreteDataAttributePath &, StatusIB status) override
    {
        if (status.IsSuccess()) s_done.push_back(s_writing);
        else ESP_LOGW(TAG, "Node 0x%llx refused the provider", (unsigned long long)s_writing);
    }
    void OnError(const WriteClient *, CHIP_ERROR err) override
    {
        ESP_LOGW(TAG, "Node 0x%llx: %" CHIP_ERROR_FORMAT, (unsigned long long)s_writing, err.Format());
    }
    void OnDone(WriteClient *client) override
    {
        Platform::Delete(client);
        s_writing = 0;
        DeviceLayer::SystemLayer().ScheduleLambda([] { next(); });
    }
};
static Writer s_writer;

static void on_connected(void *, Messaging::ExchangeManager &mgr, const SessionHandle &session)
{
    auto *client = Platform::New<WriteClient>(&mgr, &s_writer, NullOptional);
    CHIP_ERROR err = client ? CHIP_NO_ERROR : CHIP_ERROR_NO_MEMORY;
    if (client) {
        Location loc;
        loc.providerNodeID = commissioner()->GetNodeId();
        loc.endpoint = 0;
        loc.fabricIndex = commissioner()->GetFabricIndex();
        // Fabric-scoped: replaces only the hub's own entry.
        err = client->EncodeAttribute(AttributePathParams(0, OtaSoftwareUpdateRequestor::Id,
                                                          OtaSoftwareUpdateRequestor::Attributes::DefaultOTAProviders::Id),
                                      DataModel::List<const Location>(&loc, 1));
        if (err == CHIP_NO_ERROR) err = client->SendWriteRequest(session);
        if (err != CHIP_NO_ERROR) Platform::Delete(client);
    }
    if (err != CHIP_NO_ERROR) {
        s_writing = 0;
        next();
    }
}

static void on_connect_failed(void *, const ScopedNodeId &, CHIP_ERROR)
{
    s_writing = 0;
    next();
}

static chip::Callback::Callback<OnDeviceConnected> s_connected(on_connected, nullptr);
static chip::Callback::Callback<OnDeviceConnectionFailure> s_connect_failed(on_connect_failed, nullptr);

static void next()
{
    if (s_writing || s_queue.empty()) return;
    s_writing = s_queue.front();
    s_queue.erase(s_queue.begin());
    if (commissioner()->GetConnectedDevice(s_writing, &s_connected, &s_connect_failed) != CHIP_NO_ERROR) {
        s_writing = 0;
        DeviceLayer::SystemLayer().ScheduleLambda([] { next(); });
    }
}

// ---------------------------------------------------------------------------------------------
// Controller hooks
// ---------------------------------------------------------------------------------------------

void espm_ota_provider_start()
{
    // Replaces esp-matter's provider (DCL only): its delegate and its BDX handler.
    auto *ss = Controller::DeviceControllerFactory::GetInstance().GetSystemState();
    esp_matter::controller::data_model::provider::get_instance().set_ota_provider_delegate(&s_provider);
    ss->ExchangeMgr()->UnregisterUnsolicitedMessageHandlerForProtocol(Protocols::BDX::Id);
    if (ss->ExchangeMgr()->RegisterUnsolicitedMessageHandlerForProtocol(Protocols::BDX::Id, &s_sender) !=
        CHIP_NO_ERROR)
        ESP_LOGE(TAG, "BDX unavailable – no updates for devices");
}

void espm_ota_provider_node_ready(uint64_t node)
{
    if (std::count(s_done.begin(), s_done.end(), node) || std::count(s_queue.begin(), s_queue.end(), node) ||
        s_writing == node)
        return;
    s_queue.push_back(node);
    next();
}

void espm_ota_provider_node_removed(uint64_t node)
{
    s_done.erase(std::remove(s_done.begin(), s_done.end(), node), s_done.end());
    s_queue.erase(std::remove(s_queue.begin(), s_queue.end(), node), s_queue.end());
    s_offers.erase(std::remove_if(s_offers.begin(), s_offers.end(), [&](const Offer &o) { return o.node == node; }),
                   s_offers.end());
}

const char *espm_ota_provider_available(uint64_t node)
{
    for (auto &o : s_offers)
        if (o.node == node && o.waiting[0]) return o.waiting;
    return nullptr;
}

esp_err_t espm_ota_provider_install(uint64_t node)
{
    // Updates on approval: the next one found is installed.
    offer_of(node).approved = true;
    // AnnounceOTAProvider (reason: update available): the device queries the hub now.
    char fields[96];
    snprintf(fields, sizeof(fields), "{\"0:U64\":%llu,\"1:U16\":%u,\"2:U8\":1,\"4:U16\":0}",
             (unsigned long long)commissioner()->GetNodeId(), (unsigned)CONFIG_ESP_MATTER_CONTROLLER_VENDOR_ID);
    return esp_matter::controller::send_invoke_cluster_command(node, 0, OtaSoftwareUpdateRequestor::Id,
                                                               OtaSoftwareUpdateRequestor::Commands::AnnounceOTAProvider::Id,
                                                               fields);
}
