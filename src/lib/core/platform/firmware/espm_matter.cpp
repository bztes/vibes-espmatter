// espmatter studio – Matter: network events for everyone; on a Matter device (not a hub, which is
// only a controller) also the root node, onboarding data, attribute dispatch and /api/v1/matter.
#include "espm.h"

#include <string.h>
#include <vector>
#include <esp_log.h>
#include <esp_netif.h>
#if ESPM_MATTER_SERVER
#include <esp_matter_providers.h>
#include <app/server/Server.h>
#include <crypto/CHIPCryptoPAL.h>
#include <platform/CommissionableDataProvider.h>
#endif

using namespace esp_matter;
using chip::DeviceLayer::ChipDeviceEvent;

static const char *TAG = "espm_matter";

#if ESPM_MATTER_SERVER
static node_t *s_node;

struct AttrHandler {
    uint16_t endpoint;
    espm_attr_cb_t cb;
    void *ctx;
};
struct IdentifyHandler {
    uint16_t endpoint;
    espm_identify_cb_t cb;
    void *ctx;
};
static std::vector<AttrHandler> s_attr;
static std::vector<IdentifyHandler> s_identify;

/** Discriminator and passcode of this device (from the app), the verifier computed at boot. */
class Onboarding : public chip::DeviceLayer::CommissionableDataProvider {
public:
    static constexpr uint32_t kIterations = 1000;

    CHIP_ERROR Init()
    {
        chip::Crypto::Hash_SHA256((const uint8_t *)ESPM_DEVICE_ID, strlen(ESPM_DEVICE_ID), mSalt);
        chip::Crypto::Spake2pVerifier verifier;
        ReturnErrorOnFailure(verifier.Generate(kIterations, chip::ByteSpan(mSalt), ESPM_MATTER_PASSCODE));
        chip::MutableByteSpan span(mVerifier);
        ReturnErrorOnFailure(verifier.Serialize(span));
        mVerifierLen = span.size();
        return CHIP_NO_ERROR;
    }
    CHIP_ERROR GetSetupDiscriminator(uint16_t &d) override { d = ESPM_MATTER_DISCRIMINATOR; return CHIP_NO_ERROR; }
    CHIP_ERROR SetSetupDiscriminator(uint16_t) override { return CHIP_ERROR_NOT_IMPLEMENTED; }
    CHIP_ERROR GetSpake2pIterationCount(uint32_t &c) override { c = kIterations; return CHIP_NO_ERROR; }
    CHIP_ERROR GetSpake2pSalt(chip::MutableByteSpan &salt) override { return chip::CopySpanToMutableSpan(chip::ByteSpan(mSalt), salt); }
    CHIP_ERROR GetSpake2pVerifier(chip::MutableByteSpan &out, size_t &len) override
    {
        len = mVerifierLen;
        return chip::CopySpanToMutableSpan(chip::ByteSpan(mVerifier, mVerifierLen), out);
    }
    CHIP_ERROR GetSetupPasscode(uint32_t &p) override { p = ESPM_MATTER_PASSCODE; return CHIP_NO_ERROR; }
    CHIP_ERROR SetSetupPasscode(uint32_t) override { return CHIP_ERROR_NOT_IMPLEMENTED; }

private:
    uint8_t mSalt[chip::Crypto::kSHA256_Hash_Length];
    uint8_t mVerifier[chip::Crypto::kSpake2p_VerifierSerialized_Length];
    size_t mVerifierLen = 0;
};
static Onboarding s_onboarding;

static esp_err_t on_attribute(attribute::callback_type_t type, uint16_t endpoint, uint32_t cluster,
                              uint32_t attribute, esp_matter_attr_val_t *val, void *)
{
    if (type != attribute::PRE_UPDATE) return ESP_OK;
    for (auto &h : s_attr)
        if (h.endpoint == endpoint) return h.cb(endpoint, cluster, attribute, val, h.ctx);
    return ESP_OK;
}

static esp_err_t on_identify(identification::callback_type_t type, uint16_t endpoint, uint8_t, uint8_t, void *)
{
    for (auto &h : s_identify)
        if (h.endpoint == endpoint) h.cb(endpoint, type == identification::START, h.ctx);
    return ESP_OK;
}

void espm_on_attribute(uint16_t endpoint, espm_attr_cb_t cb, void *ctx) { s_attr.push_back({endpoint, cb, ctx}); }
void espm_on_identify(uint16_t endpoint, espm_identify_cb_t cb, void *ctx) { s_identify.push_back({endpoint, cb, ctx}); }

esp_err_t espm_attr_update(uint16_t endpoint, uint32_t cluster, uint32_t attribute, esp_matter_attr_val_t val)
{
    return espm_locked([&] { return attribute::update(endpoint, cluster, attribute, &val); });
}

node_t *espm_node() { return s_node; }
#endif

void espm_matter_init()
{
#if !ESPM_MATTER_SERVER
    ESP_LOGI(TAG, "Matter controller only – this board is no Matter device");
#else
    if (s_onboarding.Init() == CHIP_NO_ERROR) set_custom_commissionable_data_provider(&s_onboarding);
    else ESP_LOGE(TAG, "Could not compute the SPAKE2+ verifier");

    node::config_t config;
    strncpy(config.root_node.basic_information.node_label, ESPM_DEVICE_NAME,
            sizeof(config.root_node.basic_information.node_label) - 1);
    s_node = node::create(&config, on_attribute, on_identify);
    if (!s_node) ESP_LOGE(TAG, "Failed to create the Matter node");
    else {
        // Heap figures for the controller (the hub exports them): the root node has General
        // Diagnostics (uptime, reboots) and Wi-Fi/Thread Network Diagnostics, but no Software Diagnostics.
        cluster_t *sw = cluster::software_diagnostics::create(endpoint::get(s_node, 0), nullptr, CLUSTER_FLAG_SERVER);
        if (sw) {
            cluster::software_diagnostics::attribute::create_current_heap_free(sw, 0);
            cluster::software_diagnostics::feature::watermarks::add(sw);
        }
    }
    ESP_LOGI(TAG, "Pairing code %s, QR %s", ESPM_MATTER_MANUAL_CODE, ESPM_MATTER_QR);
#endif
}

static char s_ip[16];
static bool s_online;
const char *espm_ip() { return s_ip; }
bool espm_online() { return s_online; }

static void update_ip()
{
    esp_netif_t *netif = esp_netif_get_default_netif();
    esp_netif_ip_info_t info;
    if (netif && esp_netif_get_ip_info(netif, &info) == ESP_OK && info.ip.addr)
        esp_ip4addr_ntoa(&info.ip, s_ip, sizeof(s_ip));
}

void espm_matter_event(const ChipDeviceEvent *event, intptr_t)
{
    static bool online = false;
    switch (event->Type) {
    case chip::DeviceLayer::DeviceEventType::kInterfaceIpAddressChanged:
        update_ip();
        s_online = true;
        if (!online) {
            online = true;
            espm_app_on_network();
        }
        break;
    case chip::DeviceLayer::DeviceEventType::kCommissioningComplete:
        ESP_LOGI(TAG, "Commissioning complete");
        break;
    case chip::DeviceLayer::DeviceEventType::kFailSafeTimerExpired:
        ESP_LOGW(TAG, "Commissioning failed (fail-safe timer expired)");
        break;
    default:
        break;
    }
}

#if ESPM_HTTP && ESPM_MATTER_SERVER
static esp_err_t matter_state(httpd_req_t *req)
{
    uint8_t fabrics;
    bool open;
    espm_locked([&] {
        auto &server = chip::Server::GetInstance();
        fabrics = server.GetFabricTable().FabricCount();
        open = server.GetCommissioningWindowManager().IsCommissioningWindowOpen();
    });
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "commissioned", fabrics > 0);
    cJSON_AddNumberToObject(json, "fabrics", fabrics);
    cJSON_AddBoolToObject(json, "windowOpen", open);
    cJSON_AddStringToObject(json, "qr", ESPM_MATTER_QR);
    cJSON_AddStringToObject(json, "manualCode", ESPM_MATTER_MANUAL_CODE);
    return espm_send_json(req, json);
}

static esp_err_t open_window(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *s = cJSON_GetObjectItem(body, "seconds");
    uint16_t seconds = cJSON_IsNumber(s) ? (uint16_t)s->valuedouble : 300;
    cJSON_Delete(body);
    CHIP_ERROR err = espm_locked([&] {
        return chip::Server::GetInstance().GetCommissioningWindowManager().OpenBasicCommissioningWindow(
            chip::System::Clock::Seconds16(seconds));
    });
    return err == CHIP_NO_ERROR ? espm_send_ok(req) : espm_send_error(req, 409, "window could not be opened");
}

static esp_err_t factory(httpd_req_t *req)
{
    espm_send_ok(req);
    esp_matter::factory_reset();
    return ESP_OK;
}

struct MatterRoutes {
    MatterRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/matter", matter_state);
        espm_route(HTTP_POST, "/api/v1/matter/window", open_window);
        espm_route(HTTP_POST, "/api/v1/matter/factory-reset", factory);
    }
};
static MatterRoutes s_routes;
#endif
