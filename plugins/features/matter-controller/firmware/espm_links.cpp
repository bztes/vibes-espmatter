// espmatter studio – Matter controller: links between devices. A device gets Bindings for one of its
// client clusters, its targets grant it access in their ACL; then they talk without the hub.
// One job at a time on the Matter task: read Bindings, grant new targets, write Bindings, revoke old ones.
#include "espm.h"
#include "espm_controller.h"

#include <string.h>
#include <algorithm>
#include <vector>
#include <esp_log.h>
#include <esp_timer.h>
#include <app-common/zap-generated/cluster-objects.h>
#include <app/BufferedReadCallback.h>
#include <app/InteractionModelEngine.h>
#include <app/ReadClient.h>
#include <app/WriteClient.h>
#include <platform/CHIPDeviceLayer.h>
#include <esp_matter_controller_client.h>

using namespace chip;
using namespace chip::app;
using namespace chip::app::Clusters;
using esp_matter::controller::matter_controller_client;

static const char *TAG = "espm_links";

using Ace = AccessControl::Structs::AccessControlEntryStruct::Type;
using AceTarget = AccessControl::Structs::AccessControlTargetStruct::Type;
using Target = Binding::Structs::TargetStruct::Type;
using Privilege = AccessControl::AccessControlEntryPrivilegeEnum;
using AuthMode = AccessControl::AccessControlEntryAuthModeEnum;

// Safety net only: CHIP ends every request itself, but a sleepy device can take minutes.
static constexpr int64_t JOB_TIMEOUT_US = 180 * 1000000LL;
static constexpr size_t MAX_CACHE = 16;
static constexpr size_t MAX_TARGETS = 8;

/** Clusters a linked device only reads (sensors); the others it sends commands to. */
static const uint32_t READ_ONLY[] = {
    TemperatureMeasurement::Id, RelativeHumidityMeasurement::Id, PressureMeasurement::Id,
    IlluminanceMeasurement::Id, OccupancySensing::Id,             BooleanState::Id,
};

static Privilege privilege_for(uint32_t cluster)
{
    return std::find(std::begin(READ_ONLY), std::end(READ_ONLY), cluster) != std::end(READ_ONLY) ? Privilege::kView
                                                                                                 : Privilege::kOperate;
}

/** An ACL entry with its own storage (the struct only points to lists). */
struct Entry {
    Privilege privilege;
    AuthMode auth;
    bool any_subject, any_target; // null lists
    std::vector<uint64_t> subjects;
    std::vector<AceTarget> targets;
};

struct Peer {
    uint64_t node;
    uint16_t ep;
    bool operator==(const Peer &o) const { return node == o.node && ep == o.ep; }
};

struct Link {
    uint32_t cluster;
    Peer to;
};

/** The links of an endpoint, as last read or written. */
struct Known {
    Peer from;
    std::vector<Link> links;
};
static std::vector<Known> s_known;

enum Step : uint8_t { IDLE, READ_BINDING, ACL_READ, ACL_WRITE, WRITE_BINDING };

struct AclOp {
    Peer target;
    bool give;
};

struct Job {
    Step step;
    Peer from;
    uint32_t cluster;
    bool change; // false: only read the links
    std::vector<Peer> targets;  // the new ones for `cluster`
    std::vector<Link> links;    // what the Binding holds (read)
    std::vector<Target> keep;   // Binding entries not of `cluster`
    std::vector<AclOp> ops;     // grants to give before the Binding write, take after it
    size_t op;
    bool bound;                 // the Binding is written
    std::vector<Entry> acl;
    int64_t started;
};
static Job s_job;
/** Result of the last job, for the endpoint it ran on. */
static struct {
    Peer from;
    const char *error;
} s_last;

static void next();

static void schedule_next()
{
    DeviceLayer::SystemLayer().ScheduleLambda([] { next(); });
}

static AttributePathParams binding_path(uint16_t ep)
{
    return AttributePathParams(ep, Binding::Id, Binding::Attributes::Binding::Id);
}

static AttributePathParams acl_path()
{
    return AttributePathParams(0, AccessControl::Id, AccessControl::Attributes::Acl::Id);
}

static void remember(const Peer &from, std::vector<Link> links)
{
    for (auto &k : s_known)
        if (k.from == from) {
            k.links = std::move(links);
            return;
        }
    if (s_known.size() >= MAX_CACHE) s_known.erase(s_known.begin());
    s_known.push_back({from, std::move(links)});
}

static void finish(const char *error)
{
    if (error)
        ESP_LOGW(TAG, "Links of 0x%llx/%u: %s", (unsigned long long)s_job.from.node, s_job.from.ep, error);
    else remember(s_job.from, s_job.links);
    s_last = {s_job.from, error};
    s_job = {};
}

// ---------------------------------------------------------------------------------------------
// Requests: one at a time, each answered by on_data / the writer, then next()
// ---------------------------------------------------------------------------------------------

static bool s_failed;     // the current request failed
static uint64_t s_target; // node of the current request

static CHIP_ERROR read_binding(TLV::TLVReader &data)
{
    Binding::Attributes::Binding::TypeInfo::DecodableType list;
    ReturnErrorOnFailure(DataModel::Decode(data, list));
    s_job.links.clear();
    s_job.keep.clear();
    auto it = list.begin();
    while (it.Next()) {
        const auto &t = it.GetValue();
        const bool unicast = t.cluster.HasValue() && t.node.HasValue() && t.endpoint.HasValue();
        if (unicast) s_job.links.push_back({t.cluster.Value(), {t.node.Value(), t.endpoint.Value()}});
        if (unicast && s_job.change && t.cluster.Value() == s_job.cluster) continue; // replaced
        Target keep;
        keep.node = t.node;
        keep.group = t.group;
        keep.endpoint = t.endpoint;
        keep.cluster = t.cluster;
        s_job.keep.push_back(keep);
    }
    return it.GetStatus();
}

static CHIP_ERROR read_acl(TLV::TLVReader &data)
{
    AccessControl::Attributes::Acl::TypeInfo::DecodableType list;
    ReturnErrorOnFailure(DataModel::Decode(data, list));
    s_job.acl.clear();
    auto it = list.begin();
    while (it.Next()) {
        const auto &a = it.GetValue();
        Entry e = {a.privilege, a.authMode, a.subjects.IsNull(), a.targets.IsNull(), {}, {}};
        if (!a.subjects.IsNull()) {
            auto s = a.subjects.Value().begin();
            while (s.Next()) e.subjects.push_back(s.GetValue());
            ReturnErrorOnFailure(s.GetStatus());
        }
        if (!a.targets.IsNull()) {
            auto t = a.targets.Value().begin();
            while (t.Next()) e.targets.push_back(t.GetValue());
            ReturnErrorOnFailure(t.GetStatus());
        }
        s_job.acl.push_back(std::move(e));
    }
    return it.GetStatus();
}

class Reader : public ReadClient::Callback {
    void OnAttributeData(const ConcreteDataAttributePath &, TLV::TLVReader *data, const StatusIB &status) override
    {
        CHIP_ERROR err = !status.IsSuccess() || !data ? CHIP_ERROR_INTERNAL
                         : s_job.step == READ_BINDING ? read_binding(*data)
                                                      : read_acl(*data);
        if (err != CHIP_NO_ERROR) s_failed = true;
    }
    void OnError(CHIP_ERROR) override { s_failed = true; }
    void OnDone(ReadClient *client) override
    {
        Platform::Delete(client);
        schedule_next();
    }
};
static Reader s_reader;
static BufferedReadCallback s_buffered(s_reader);

class Writer : public WriteClient::Callback {
    void OnResponse(const WriteClient *, const ConcreteDataAttributePath &, StatusIB status) override
    {
        if (!status.IsSuccess()) s_failed = true;
    }
    void OnError(const WriteClient *, CHIP_ERROR) override { s_failed = true; }
    void OnDone(WriteClient *client) override
    {
        Platform::Delete(client);
        schedule_next();
    }
};
static Writer s_writer;

/** Builds the list the current write step sends, then sends it. */
static CHIP_ERROR send_write(Messaging::ExchangeManager &mgr, const SessionHandle &session)
{
    auto *client = Platform::New<WriteClient>(&mgr, &s_writer, NullOptional);
    VerifyOrReturnError(client, CHIP_ERROR_NO_MEMORY);
    CHIP_ERROR err;
    if (s_job.step == WRITE_BINDING) {
        std::vector<Target> list = s_job.keep;
        for (const Peer &p : s_job.targets) {
            Target t;
            t.node.SetValue(p.node);
            t.endpoint.SetValue(p.ep);
            t.cluster.SetValue(s_job.cluster);
            list.push_back(t);
        }
        err = client->EncodeAttribute(binding_path(s_job.from.ep), DataModel::List<const Target>(list.data(), list.size()));
    } else {
        std::vector<Ace> list;
        for (auto &e : s_job.acl) {
            Ace a;
            a.privilege = e.privilege;
            a.authMode = e.auth;
            if (!e.any_subject) a.subjects.SetNonNull(DataModel::List<const uint64_t>(e.subjects.data(), e.subjects.size()));
            if (!e.any_target) a.targets.SetNonNull(DataModel::List<const AceTarget>(e.targets.data(), e.targets.size()));
            list.push_back(a);
        }
        err = client->EncodeAttribute(acl_path(), DataModel::List<const Ace>(list.data(), list.size()));
    }
    if (err == CHIP_NO_ERROR) err = client->SendWriteRequest(session);
    if (err != CHIP_NO_ERROR) Platform::Delete(client);
    return err;
}

static void on_connected(void *, Messaging::ExchangeManager &mgr, const SessionHandle &session)
{
    if (s_job.step == IDLE) return;
    CHIP_ERROR err;
    if (s_job.step == READ_BINDING || s_job.step == ACL_READ) {
        static AttributePathParams path;
        path = s_job.step == READ_BINDING ? binding_path(s_job.from.ep) : acl_path();
        auto *client = Platform::New<ReadClient>(InteractionModelEngine::GetInstance(), &mgr, s_buffered,
                                                 ReadClient::InteractionType::Read);
        ReadPrepareParams params(session);
        params.mpAttributePathParamsList = &path;
        params.mAttributePathParamsListSize = 1;
        params.mIsFabricFiltered = true; // only the hub's own entries: a write replaces just those
        err = client ? client->SendRequest(params) : CHIP_ERROR_NO_MEMORY;
        if (err != CHIP_NO_ERROR) Platform::Delete(client);
    } else {
        err = send_write(mgr, session);
    }
    if (err != CHIP_NO_ERROR) {
        s_failed = true;
        next();
    }
}

static void on_connect_failed(void *, const ScopedNodeId &, CHIP_ERROR)
{
    if (s_job.step == IDLE) return;
    s_failed = true;
    next();
}

static chip::Callback::Callback<OnDeviceConnected> s_connected(on_connected, nullptr);
static chip::Callback::Callback<OnDeviceConnectionFailure> s_connect_failed(on_connect_failed, nullptr);

static void request(uint64_t node)
{
    s_failed = false;
    s_target = node;
    auto &client = matter_controller_client::get_instance();
#ifdef CONFIG_ESP_MATTER_COMMISSIONER_ENABLE
    auto *ctrl = client.get_commissioner();
#else
    auto *ctrl = client.get_controller();
#endif
    if (!ctrl || ctrl->GetConnectedDevice(node, &s_connected, &s_connect_failed) != CHIP_NO_ERROR) {
        s_failed = true;
        schedule_next();
    }
}

// ---------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------

/** The entry the hub keeps for (privilege, cluster, endpoint): its subjects are the linked devices. */
static bool is_link_entry(const Entry &e, Privilege privilege, uint32_t cluster, uint16_t ep)
{
    return e.privilege == privilege && e.auth == AuthMode::kCase && !e.any_subject && !e.any_target &&
           e.targets.size() == 1 && !e.targets[0].cluster.IsNull() && e.targets[0].cluster.Value() == cluster &&
           !e.targets[0].endpoint.IsNull() && e.targets[0].endpoint.Value() == ep && e.targets[0].deviceType.IsNull();
}

/** Adds or removes the device in the target's ACL; false: nothing to change. */
static bool grant(bool give, uint16_t ep)
{
    const Privilege privilege = privilege_for(s_job.cluster);
    const uint64_t subject = s_job.from.node;
    for (size_t i = 0; i < s_job.acl.size(); i++) {
        Entry &e = s_job.acl[i];
        if (!is_link_entry(e, privilege, s_job.cluster, ep)) continue;
        auto it = std::find(e.subjects.begin(), e.subjects.end(), subject);
        if (give) {
            if (it != e.subjects.end()) return false;
            e.subjects.push_back(subject);
            return true;
        }
        if (it == e.subjects.end()) continue;
        e.subjects.erase(it);
        if (e.subjects.empty()) s_job.acl.erase(s_job.acl.begin() + i);
        return true;
    }
    if (!give) return false;
    Entry e = {privilege, AuthMode::kCase, false, false, {subject}, {}};
    AceTarget t;
    t.cluster.SetNonNull(s_job.cluster);
    t.endpoint.SetNonNull(ep);
    e.targets.push_back(t);
    s_job.acl.push_back(std::move(e));
    return true;
}

/** Plans the grants: new targets first (before the Binding), removed ones last (after it). */
static void plan()
{
    std::vector<Peer> old;
    for (const Link &l : s_job.links)
        if (l.cluster == s_job.cluster) old.push_back(l.to);
    for (const Peer &p : s_job.targets) s_job.ops.push_back({p, true});
    for (const Peer &p : old)
        if (std::find(s_job.targets.begin(), s_job.targets.end(), p) == s_job.targets.end())
            s_job.ops.push_back({p, false});
}

/** Starts the next grant to handle at this point, or false. Gives come before the Binding, takes after it. */
static bool next_op()
{
    if (s_job.op >= s_job.ops.size() || s_job.ops[s_job.op].give == s_job.bound) return false;
    s_job.step = ACL_READ;
    request(s_job.ops[s_job.op].target.node);
    return true;
}

/** Next grant, else the Binding write, else done. */
static void proceed()
{
    if (next_op()) return;
    if (s_job.bound) return finish(nullptr);
    s_job.step = WRITE_BINDING;
    request(s_job.from.node);
}

/** Runs the step after the one that just ended. */
static void next()
{
    if (s_job.step == IDLE) return;
    const bool taking = (s_job.step == ACL_READ || s_job.step == ACL_WRITE) && !s_job.ops[s_job.op].give;
    if (s_failed && taking) {
        // A gone or broken old target keeps a stale grant – harmless, it mustn't block the change.
        ESP_LOGW(TAG, "Node 0x%llx: could not take back access of 0x%llx", (unsigned long long)s_target,
                 (unsigned long long)s_job.from.node);
        s_failed = false;
        s_job.op++;
        return proceed();
    }
    if (s_failed) {
        switch (s_job.step) {
        case READ_BINDING: return finish("could not read the device's links – is it online and does it support them?");
        case ACL_READ: return finish("a linked device does not answer");
        case ACL_WRITE: return finish("a linked device refused access (its access list may be full)");
        default: return finish("the device refused the links (its binding list may be full)");
        }
    }
    switch (s_job.step) {
    case READ_BINDING:
        if (!s_job.change) return finish(nullptr);
        plan();
        return proceed();
    case ACL_READ:
        if (!grant(s_job.ops[s_job.op].give, s_job.ops[s_job.op].target.ep)) {
            s_job.op++;
            return proceed();
        }
        s_job.step = ACL_WRITE;
        return request(s_job.ops[s_job.op].target.node);
    case ACL_WRITE:
        s_job.op++;
        return proceed();
    case WRITE_BINDING:
        s_job.bound = true;
        s_job.links.erase(std::remove_if(s_job.links.begin(), s_job.links.end(),
                                         [](const Link &l) { return l.cluster == s_job.cluster; }),
                          s_job.links.end());
        for (const Peer &p : s_job.targets) s_job.links.push_back({s_job.cluster, p});
        ESP_LOGI(TAG, "Node 0x%llx/%u: %u link(s) for cluster 0x%lx", (unsigned long long)s_job.from.node, s_job.from.ep,
                 (unsigned)s_job.targets.size(), (unsigned long)s_job.cluster);
        return proceed();
    default: return;
    }
}

/** A job whose devices never answered ends here. Stack lock held. */
static void expire()
{
    if (s_job.step != IDLE && esp_timer_get_time() - s_job.started > JOB_TIMEOUT_US) finish("timed out");
}

/** Stack lock held. */
static const char *start(Peer from, bool change, uint32_t cluster, std::vector<Peer> targets)
{
    expire();
    if (s_job.step != IDLE) return "busy with other links";
    s_job = {};
    s_job.step = READ_BINDING;
    s_job.from = from;
    s_job.change = change;
    s_job.cluster = cluster;
    s_job.targets = std::move(targets);
    s_job.started = esp_timer_get_time();
    s_last = {from, nullptr};
    request(from.node);
    return nullptr;
}

/** A node left the fabric: forget what's known about its links. Stack lock held. */
void espm_links_node_removed(uint64_t node)
{
    s_known.erase(std::remove_if(s_known.begin(), s_known.end(),
                                 [node](const Known &k) {
                                     return k.from.node == node ||
                                            std::any_of(k.links.begin(), k.links.end(),
                                                        [node](const Link &l) { return l.to.node == node; });
                                 }),
                  s_known.end());
}

// ---------------------------------------------------------------------------------------------
// REST API (admins)
// ---------------------------------------------------------------------------------------------

#if ESPM_HTTP
static bool query_uint(httpd_req_t *req, const char *key, uint64_t &out)
{
    char query[96], value[24];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        httpd_query_key_value(query, key, value, sizeof(value)) != ESP_OK)
        return false;
    char *end;
    out = strtoull(value, &end, 10);
    return end != value && !*end;
}

static cJSON *state_json(const Peer &from)
{
    cJSON *json = cJSON_CreateObject();
    const bool busy = s_job.step != IDLE && s_job.from == from;
    cJSON_AddStringToObject(json, "state", busy ? "busy" : "idle");
    if (!busy && s_last.from == from && s_last.error) cJSON_AddStringToObject(json, "error", s_last.error);
    for (const auto &k : s_known) {
        if (!(k.from == from)) continue;
        cJSON *list = cJSON_AddArrayToObject(json, "links");
        for (const Link &l : k.links) {
            cJSON *o = cJSON_CreateObject();
            cJSON_AddNumberToObject(o, "cluster", l.cluster);
            cJSON_AddNumberToObject(o, "node", (double)l.to.node);
            cJSON_AddNumberToObject(o, "endpoint", l.to.ep);
            cJSON_AddItemToArray(list, o);
        }
    }
    return json;
}

/** The endpoint's links; not known yet or `read=1`: starts reading them (poll until `state` is `idle`). */
static esp_err_t get_links(httpd_req_t *req)
{
    uint64_t node, ep;
    if (!query_uint(req, "node", node) || !query_uint(req, "endpoint", ep) || ep > 0xFFFE)
        return espm_send_error(req, 400, "node and endpoint are required");
    const Peer from = {node, (uint16_t)ep};
    cJSON *json = espm_locked([&] {
        expire();
        const bool known = std::any_of(s_known.begin(), s_known.end(), [&](const Known &k) { return k.from == from; });
        const bool failed = s_last.from == from && s_last.error;
        uint64_t fresh = 0;
        query_uint(req, "read", fresh);
        if ((fresh || (!known && !failed)) && s_job.step == IDLE && espm_controller_has_endpoint(node, from.ep))
            start(from, false, 0, {});
        return state_json(from);
    });
    return espm_send_json(req, json);
}

static esp_err_t put_links(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    auto num = [](cJSON *o, const char *key, double max, uint64_t &out) {
        cJSON *v = cJSON_GetObjectItem(o, key);
        if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > max) return false;
        out = (uint64_t)v->valuedouble;
        return true;
    };
    uint64_t node, ep, cluster;
    std::vector<Peer> targets;
    const char *err = nullptr;
    cJSON *list = cJSON_GetObjectItem(body, "targets");
    if (!num(body, "node", 1e15, node) || !num(body, "endpoint", 0xFFFE, ep) || !num(body, "cluster", 0xFFFFFFFF, cluster))
        err = "node, endpoint and cluster are required";
    else if (!cJSON_IsArray(list) || cJSON_GetArraySize(list) > (int)MAX_TARGETS)
        err = "targets: a list of up to 8 {node, endpoint}";
    else {
        cJSON *t;
        cJSON_ArrayForEach(t, list)
        {
            uint64_t tn, te;
            if (!num(t, "node", 1e15, tn) || !num(t, "endpoint", 0xFFFE, te)) {
                err = "targets: a list of up to 8 {node, endpoint}";
                break;
            }
            if (tn == node) {
                err = "a device can't be linked to itself";
                break;
            }
            Peer p = {tn, (uint16_t)te};
            if (std::find(targets.begin(), targets.end(), p) == targets.end()) targets.push_back(p);
        }
    }
    cJSON_Delete(body);
    if (err) return espm_send_error(req, 400, err);
    const Peer from = {node, (uint16_t)ep};
    int status = 409;
    cJSON *json = espm_locked([&]() -> cJSON * {
        if (!espm_controller_serves(node, from.ep, cluster, true)) {
            status = 400;
            err = "the device can't link this cluster";
            return nullptr;
        }
        for (const Peer &p : targets)
            if (!espm_controller_serves(p.node, p.ep, cluster)) {
                status = 400;
                err = "a target does not have this cluster";
                return nullptr;
            }
        if ((err = start(from, true, cluster, std::move(targets)))) return nullptr;
        return state_json(from);
    });
    return json ? espm_send_json(req, json) : espm_send_error(req, status, err);
}

struct LinkRoutes {
    LinkRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/controller/links", get_links);
        espm_route(HTTP_PUT, "/api/v1/controller/links", put_links);
    }
};
static LinkRoutes s_routes;
#endif
