// espmatter studio – Matter controller: commissioning, a small node registry (NVS), discovery of
// what every node is (Descriptor), a live subscription to the attributes the dashboard shows,
// commands and attribute writes. Also the metric source for exporters (OpenTelemetry): every
// followed value plus each node's diagnostics, so devices need no exporter of their own.
#include "espm.h"
#include "espm_controller.h"

#include <math.h>
#include <string.h>
#include <time.h>
#include <string>
#include <vector>
#include <algorithm>
#include <optional>
#include <esp_log.h>
#include <esp_timer.h>
#include <nvs.h>
#include <app-common/zap-generated/cluster-objects.h>
#include <app/data-model/Decode.h>
#include <platform/CHIPDeviceLayer.h>
#include <setup_payload/ManualSetupPayloadParser.h>
#include <setup_payload/QRCodeSetupPayloadParser.h>
#include <esp_matter_controller_client.h>
#include <esp_matter_controller_cluster_command.h>
#include <esp_matter_controller_pairing_command.h>
#include <esp_matter_controller_read_command.h>
#include <esp_matter_controller_subscribe_command.h>
#include <esp_matter_controller_write_command.h>

using namespace esp_matter;
using namespace chip::app::Clusters;
using chip::app::AttributePathParams;
using chip::app::ConcreteDataAttributePath;
using chip::app::EventPathParams;
using chip::Platform::ScopedMemoryBufferWithSize;

static const char *TAG = "espm_ctrl";

// ---------------------------------------------------------------------------------------------
// The attributes the hub follows. Order = priority: a subscription carries at most
// MAX_SUB_PATHS of them (a server only guarantees 3 subscriptions × 3 paths per fabric).
// ---------------------------------------------------------------------------------------------

// K_FIELD0: field 0 of a struct (EnergyMeasurementStruct: energy).
enum Kind : uint8_t { K_NUM, K_BOOL, K_BIT, K_LUX, K_FIELD0 };
struct Attr {
    uint32_t cluster, attribute;
    const char *key;
    float scale;
    Kind kind;
    const char *metric, *unit; // exported as (null: not exported)
};
static const Attr ATTRS[] = {
    {OnOff::Id, 0x0000, "on", 1, K_BOOL, "on_off", "1"},
    {LevelControl::Id, 0x0000, "level", 1, K_NUM, "level", "1"},
    // Color Control, tunable white. Lights without the CT feature answer UnsupportedAttribute.
    {ColorControl::Id, 0x0007, "colorTemperature", 1, K_NUM, "color_temperature", "mired"}, // ColorTemperatureMireds
    {ColorControl::Id, 0x400B, "colorTempMin", 1, K_NUM, nullptr, nullptr}, // ColorTempPhysicalMinMireds
    {ColorControl::Id, 0x400C, "colorTempMax", 1, K_NUM, nullptr, nullptr}, // ColorTempPhysicalMaxMireds
    {WindowCovering::Id, 0x000E, "closedPercent", 0.01f, K_NUM, "closed_percent", "%"}, // CurrentPositionLiftPercent100ths
    {DoorLock::Id, 0x0000, "lockState", 1, K_NUM, "lock_state", "1"},
    {Thermostat::Id, 0x0000, "localTemperature", 0.01f, K_NUM, "thermostat_local_temperature", "Cel"},
    {Thermostat::Id, 0x001C, "systemMode", 1, K_NUM, "thermostat_system_mode", "1"},
    {Thermostat::Id, 0x0012, "heatingSetpoint", 0.01f, K_NUM, "thermostat_heating_setpoint", "Cel"},
    {Thermostat::Id, 0x0011, "coolingSetpoint", 0.01f, K_NUM, "thermostat_cooling_setpoint", "Cel"},
    {Thermostat::Id, 0x001B, "controlSequence", 1, K_NUM, nullptr, nullptr},
    {FanControl::Id, 0x0000, "fanMode", 1, K_NUM, "fan_mode", "1"},
    {Thermostat::Id, 0x0001, "outdoorTemperature", 0.01f, K_NUM, "thermostat_outdoor_temperature", "Cel"},
    {TemperatureMeasurement::Id, 0x0000, "temperature", 0.01f, K_NUM, "temperature", "Cel"},
    {RelativeHumidityMeasurement::Id, 0x0000, "humidity", 0.01f, K_NUM, "humidity", "%"},
    {BooleanState::Id, 0x0000, "stateValue", 1, K_BOOL, "boolean_state", "1"},
    {OccupancySensing::Id, 0x0000, "occupied", 1, K_BIT, "occupancy", "1"},
    {IlluminanceMeasurement::Id, 0x0000, "illuminance", 1, K_LUX, "illuminance", "lx"},
    {PressureMeasurement::Id, 0x0000, "pressure", 1, K_NUM, "pressure", "hPa"}, // 0.1 kPa = hPa
    // Electrical Power / Energy Measurement (e.g. plugs): ActivePower mW, CumulativeEnergyImported mWh.
    {0x0090, 0x0008, "power", 0.001f, K_NUM, "power", "W"},
    {0x0091, 0x0001, "energy", 1e-6f, K_FIELD0, "energy", "kWh"},
    // Generic Switch: which gestures its buttons report (bit 4 multi-press, bit 5 action switch).
    {Switch::Id, 0xFFFC, "switchFeatures", 1, K_NUM, nullptr, nullptr}, // FeatureMap
};
static constexpr int N_ATTRS = sizeof(ATTRS) / sizeof(ATTRS[0]);
static_assert(N_ATTRS <= 32, "attribute masks are 32 bit");
static constexpr int MAX_SUB_PATHS = 9;
static constexpr int MAX_ENDPOINTS = 16;
static constexpr int MAX_CONNECTING = 3;
static constexpr int MAX_CLUSTERS = 16;

/** Diagnostics of a node (root endpoint), read every DIAG_INTERVAL_S rather than subscribed. */
struct Diag {
    uint32_t cluster, attribute;
    const char *key, *metric, *unit;
};
static const Diag DIAGS[] = {
    {GeneralDiagnostics::Id, 0x0002, "uptime", "device.uptime", "s"},                          // UpTime
    {GeneralDiagnostics::Id, 0x0001, "rebootCount", "device.reboots", "1"},                    // RebootCount
    {SoftwareDiagnostics::Id, 0x0001, "heapFree", "device.memory.free", "By"},                 // CurrentHeapFree
    {SoftwareDiagnostics::Id, 0x0003, "heapHighWatermark", "device.memory.high_watermark", "By"}, // CurrentHeapHighWatermark
};
static constexpr int N_DIAGS = sizeof(DIAGS) / sizeof(DIAGS[0]);
static constexpr int DIAG_INTERVAL_S = 60;
static constexpr int MAX_DIAG_READS_PER_TICK = 2;

struct Ep {
    uint16_t id;
    uint8_t ntypes;
    uint32_t types[4];
    uint8_t nclusters;
    uint32_t clusters[MAX_CLUSTERS]; // server clusters (Descriptor ServerList)
    uint32_t has;   // ATTRS whose cluster the endpoint serves
    uint32_t valid; // ATTRS with a reported value
    uint32_t null;  // … that is null
    float val[N_ATTRS];
};

/** NVS layout (unchanged since the first version; `on` is unused). */
struct Stored {
    uint64_t id;
    char name[32];
    bool on;
};

enum State : uint8_t { OFFLINE, CONNECTING, ONLINE };
static const char *STATE_NAMES[] = {"offline", "connecting", "online"};

struct Node {
    uint64_t id;
    char name[32];
    State state;
    bool discovered;    // the descriptor read returned data
    const void *sub;    // the pending/active subscribe_command – identity only, never dereferenced
    int64_t since;      // s, last state change
    int64_t retry_at;   // s
    uint16_t backoff;   // s
    std::vector<Ep> eps;
    int64_t diag_at;    // s, next diagnostics read
    uint8_t diag_valid; // DIAGS with a value
    double diag[N_DIAGS];
    // Button events (automations): devices replay their event history to every new subscription.
    bool ev_known;           // ev_last is valid
    uint64_t ev_last;        // highest event number handled (persisted)
    int64_t ev_ignore_until; // s: history of a switch we never heard from before
    // For the device list (admin page).
    char tags[64];             // comma-separated, persisted under "t<id>"
    char vendor[32], product[32], sw[24]; // Basic Information, read at discovery
    bool power;                // has a Power Source cluster: battery is subscribed
    int16_t battery;           // BatPercentRemaining in %, -1 unknown
    int8_t charge;             // BatChargeLevel: 0 ok, 1 warning, 2 critical, -1 unknown
    int64_t seen_at;           // s, last report of any kind (0: none since boot)
};
static const char *CHARGE_NAMES[] = {"ok", "warning", "critical"};
static constexpr int MAX_TAG_LEN = 24;

static std::vector<Node> s_nodes;
static uint64_t s_next_id = 16;
static const char *s_pair_state = "idle";
static const char *s_pair_error = ""; // why the last pairing failed, for the UI
static uint64_t s_pair_node;
static std::string s_pair_name;
static int64_t s_pair_since;
/** From the thread-border-router feature, if the firmware has it: the hub's Thread network. */
__attribute__((weak)) size_t espm_otbr_dataset(uint8_t *buf, size_t size);
static bool s_pair_found; // PASE established: the device was found and the code accepted
/** Network discovery never gives up on its own: stop looking for the device after this long. */
static constexpr int64_t PAIR_DISCOVERY_TIMEOUT_S = 90;

static int64_t now() { return esp_timer_get_time() / 1000000; }

static Node *find(uint64_t id)
{
    for (auto &n : s_nodes)
        if (n.id == id) return &n;
    return nullptr;
}

static Ep *endpoint_of(Node &n, uint16_t id)
{
    for (auto &e : n.eps)
        if (e.id == id) return &e;
    if (n.eps.size() >= MAX_ENDPOINTS) return nullptr;
    Ep e = {};
    e.id = id;
    n.eps.push_back(e);
    return &n.eps.back();
}

static Node make_node(uint64_t id, const char *name)
{
    Node n = {};
    n.id = id;
    strlcpy(n.name, name, sizeof(n.name));
    n.state = OFFLINE;
    n.backoff = 15;
    n.battery = -1;
    n.charge = -1;
    return n;
}

static void tags_key(uint64_t id, char *key, size_t len)
{
    snprintf(key, len, "t%llx", (unsigned long long)id); // NVS keys are max. 15 chars
}

/** Store a node's tags (comma-separated; "" deletes them). */
static void tags_save(const Node &n)
{
    nvs_handle_t h;
    if (nvs_open("espm_ctrl", NVS_READWRITE, &h) != ESP_OK) return;
    char key[16];
    tags_key(n.id, key, sizeof(key));
    if (n.tags[0]) nvs_set_str(h, key, n.tags);
    else nvs_erase_key(h, key);
    nvs_commit(h);
    nvs_close(h);
}

static void save()
{
    std::vector<Stored> stored;
    for (auto &n : s_nodes) {
        Stored s = {};
        s.id = n.id;
        strlcpy(s.name, n.name, sizeof(s.name));
        stored.push_back(s);
    }
    nvs_handle_t h;
    if (nvs_open("espm_ctrl", NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_blob(h, "nodes", stored.data(), stored.size() * sizeof(Stored));
    nvs_set_u64(h, "next", s_next_id);
    nvs_commit(h);
    nvs_close(h);
}

static void load()
{
    nvs_handle_t h;
    if (nvs_open("espm_ctrl", NVS_READONLY, &h) != ESP_OK) return;
    size_t len = 0;
    if (nvs_get_blob(h, "nodes", nullptr, &len) == ESP_OK && len % sizeof(Stored) == 0) {
        std::vector<Stored> stored(len / sizeof(Stored));
        nvs_get_blob(h, "nodes", stored.data(), &len);
        for (auto &s : stored) {
            s.name[sizeof(s.name) - 1] = 0;
            Node n = make_node(s.id, s.name);
            char key[16];
            tags_key(n.id, key, sizeof(key));
            size_t tlen = sizeof(n.tags);
            if (nvs_get_str(h, key, n.tags, &tlen) != ESP_OK) n.tags[0] = 0;
            s_nodes.push_back(n);
        }
    }
    nvs_get_u64(h, "next", &s_next_id);
    nvs_close(h);
}

// ---------------------------------------------------------------------------------------------
// Discovery and subscription. Everything below runs in the Matter task (stack lock held).
// ---------------------------------------------------------------------------------------------

static void set_offline(Node &n)
{
    if (n.state != OFFLINE) ESP_LOGW(TAG, "Node 0x%llx offline", (unsigned long long)n.id);
    n.state = OFFLINE;
    n.sub = nullptr;
    n.diag_valid = 0;
    n.since = now();
    n.retry_at = n.since + n.backoff;
    n.backoff = std::min<uint16_t>(n.backoff * 2, 300);
}

static void set_online(Node &n)
{
    if (n.state == ONLINE) return;
    ESP_LOGI(TAG, "Node 0x%llx online", (unsigned long long)n.id);
    n.state = ONLINE;
    n.since = now();
    n.backoff = 15;
    n.diag_at = n.since;
}

static bool read_number(chip::TLV::TLVReader &r, double &out, bool &null);

/** Field 0 of a struct (a copy of the reader: the caller's stays put); null if missing. */
static bool read_field0(chip::TLV::TLVReader r, double &out, bool &null)
{
    if (r.GetType() != chip::TLV::kTLVType_Structure) return read_number(r, out, null);
    chip::TLV::TLVType outer;
    if (r.EnterContainer(outer) != CHIP_NO_ERROR) return false;
    while (r.Next() == CHIP_NO_ERROR)
        if (r.GetTag() == chip::TLV::ContextTag(0)) return read_number(r, out, null);
    null = true;
    return true;
}

static bool read_number(chip::TLV::TLVReader &r, double &out, bool &null)
{
    null = false;
    switch (r.GetType()) {
    case chip::TLV::kTLVType_Null:
        null = true;
        return true;
    case chip::TLV::kTLVType_Boolean: {
        bool v;
        if (r.Get(v) != CHIP_NO_ERROR) return false;
        out = v;
        return true;
    }
    case chip::TLV::kTLVType_SignedInteger: {
        int64_t v;
        if (r.Get(v) != CHIP_NO_ERROR) return false;
        out = (double)v;
        return true;
    }
    case chip::TLV::kTLVType_UnsignedInteger: {
        uint64_t v;
        if (r.Get(v) != CHIP_NO_ERROR) return false;
        out = (double)v;
        return true;
    }
    case chip::TLV::kTLVType_FloatingPointNumber: {
        double v;
        if (r.Get(v) != CHIP_NO_ERROR) return false;
        out = v;
        return true;
    }
    default:
        return false;
    }
}

/** An attribute report of a node, from the discovery read or the subscription. */
static void copy_string(chip::TLV::TLVReader &r, char *out, size_t size)
{
    chip::CharSpan v;
    if (chip::app::DataModel::Decode(r, v) != CHIP_NO_ERROR) return;
    size_t len = std::min(v.size(), size - 1);
    memcpy(out, v.data(), len);
    out[len] = 0;
}

/** What belongs to the node rather than an endpoint: what it is, its battery. */
static bool store_node(Node &n, const ConcreteDataAttributePath &path, chip::TLV::TLVReader &data)
{
    if (path.mClusterId == BasicInformation::Id) {
        if (path.mAttributeId == BasicInformation::Attributes::VendorName::Id) copy_string(data, n.vendor, sizeof(n.vendor));
        else if (path.mAttributeId == BasicInformation::Attributes::ProductName::Id)
            copy_string(data, n.product, sizeof(n.product));
        else if (path.mAttributeId == BasicInformation::Attributes::SoftwareVersionString::Id)
            copy_string(data, n.sw, sizeof(n.sw));
        return true;
    }
    if (path.mClusterId == PowerSource::Id) {
        double v;
        bool null;
        if (!read_number(data, v, null)) return true;
        if (path.mAttributeId == PowerSource::Attributes::BatPercentRemaining::Id)
            n.battery = null ? -1 : (int16_t)std::min(100.0, v / 2); // half percent
        else if (path.mAttributeId == PowerSource::Attributes::BatChargeLevel::Id)
            n.charge = null || v > 2 ? -1 : (int8_t)v;
        return true;
    }
    if (path.mClusterId == Descriptor::Id && path.mAttributeId == Descriptor::Attributes::ServerList::Id) {
        // Battery-powered devices have a Power Source cluster, on the root or an endpoint of its own.
        chip::TLV::TLVReader copy;
        copy.Init(data);
        Descriptor::Attributes::ServerList::TypeInfo::DecodableType list;
        if (chip::app::DataModel::Decode(copy, list) == CHIP_NO_ERROR) {
            auto it = list.begin();
            while (it.Next())
                if (it.GetValue() == PowerSource::Id) n.power = true;
        }
    }
    return false;
}

static void store(Node &n, const ConcreteDataAttributePath &path, chip::TLV::TLVReader *data)
{
    if (!data) return;
    n.seen_at = now();
    if (store_node(n, path, *data)) return;
    if (path.mEndpointId == 0) return; // the root endpoint is no device
    Ep *e = endpoint_of(n, path.mEndpointId);
    if (!e) return;

    if (path.mClusterId == Descriptor::Id) {
        if (path.mAttributeId == Descriptor::Attributes::DeviceTypeList::Id) {
            Descriptor::Attributes::DeviceTypeList::TypeInfo::DecodableType list;
            if (chip::app::DataModel::Decode(*data, list) != CHIP_NO_ERROR) return;
            e->ntypes = 0;
            auto it = list.begin();
            while (it.Next())
                if (e->ntypes < 4) e->types[e->ntypes++] = it.GetValue().deviceType;
        } else if (path.mAttributeId == Descriptor::Attributes::ServerList::Id) {
            Descriptor::Attributes::ServerList::TypeInfo::DecodableType list;
            if (chip::app::DataModel::Decode(*data, list) != CHIP_NO_ERROR) return;
            e->has = 0;
            e->nclusters = 0;
            auto it = list.begin();
            while (it.Next()) {
                if (e->nclusters < MAX_CLUSTERS) e->clusters[e->nclusters++] = it.GetValue();
                for (int i = 0; i < N_ATTRS; i++)
                    if (ATTRS[i].cluster == it.GetValue()) e->has |= 1u << i;
            }
        }
        return;
    }

    for (int i = 0; i < N_ATTRS; i++) {
        const Attr &a = ATTRS[i];
        if (a.cluster != path.mClusterId || a.attribute != path.mAttributeId) continue;
        double d = 0;
        bool null;
        if (!(a.kind == K_FIELD0 ? read_field0(*data, d, null) : read_number(*data, d, null))) return;
        float v = (float)d;
        if (a.kind == K_BIT) v = ((uint32_t)v) & 1;
        else if (a.kind == K_LUX) v = v > 0 ? powf(10, (v - 1) / 10000.0f) : 0;
        else v *= a.scale;
        e->val[i] = v;
        e->valid |= 1u << i;
        if (null) e->null |= 1u << i;
        else e->null &= ~(1u << i);
        if (!null && espm_automations_value) espm_automations_value(n.id, e->id, a.key, v);
        return;
    }
}

static void on_sub_attr(uint64_t node_id, const ConcreteDataAttributePath &path, chip::TLV::TLVReader *data)
{
    Node *n = find(node_id);
    if (!n) return;
    set_online(*n);
    store(*n, path, data);
}

static void on_sub_done(uint64_t node_id, uint32_t)
{
    // The subscription ended (the node stopped answering and resubscribing gave up).
    Node *n = find(node_id);
    if (n && n->state == ONLINE) set_offline(*n);
}

static void on_sub_failed(void *cmd)
{
    for (auto &n : s_nodes)
        if (n.sub == cmd) set_offline(n);
}

// ---------------------------------------------------------------------------------------------
// Button events of Generic Switches (only with automations). Switches like IKEA BILRESA don't
// support bindings; they only report events, which become gestures for the rules.
// ---------------------------------------------------------------------------------------------

#if ESPM_CTRL_AUTOMATIONS
/** Without a stored event number, ignore what a switch reports this long after subscribing. */
static constexpr int64_t EVENT_PRIMING_S = 60;
static constexpr uint32_t SWITCH_MULTI_PRESS = 0x10, SWITCH_ACTION_SWITCH = 0x20;

static bool has_switch(const Node &n)
{
    for (auto &e : n.eps)
        for (int i = 0; i < e.nclusters; i++)
            if (e.clusters[i] == Switch::Id) return true;
    return false;
}

static void event_key(uint64_t node, char *key, size_t len)
{
    snprintf(key, len, "ev%llx", (unsigned long long)node); // NVS keys are max. 15 chars
}

static bool last_event_load(uint64_t node, uint64_t &number)
{
    nvs_handle_t h;
    if (nvs_open("espm_auto", NVS_READONLY, &h) != ESP_OK) return false;
    char key[16];
    event_key(node, key, sizeof(key));
    bool ok = nvs_get_u64(h, key, &number) == ESP_OK;
    nvs_close(h);
    return ok;
}

static void last_event_save(uint64_t node, uint64_t number)
{
    nvs_handle_t h;
    if (nvs_open("espm_auto", NVS_READWRITE, &h) != ESP_OK) return;
    char key[16];
    event_key(node, key, sizeof(key));
    nvs_set_u64(h, key, number);
    nvs_commit(h);
    nvs_close(h);
}

static void last_event_forget(uint64_t node)
{
    nvs_handle_t h;
    if (nvs_open("espm_auto", NVS_READWRITE, &h) != ESP_OK) return;
    char key[16];
    event_key(node, key, sizeof(key));
    nvs_erase_key(h, key);
    nvs_commit(h);
    nvs_close(h);
}

static void fire(uint64_t node, uint16_t ep, espm_button_t button, bool release)
{
    if (espm_automations_button) espm_automations_button(node, ep, button, release);
}

static void on_sub_event(uint64_t node_id, const chip::app::EventHeader &header, chip::TLV::TLVReader *data)
{
    if (header.mPath.mClusterId != Switch::Id) return;
    Node *n = find(node_id);
    if (!n) return;
    set_online(*n);
    n->seen_at = now();
    if (n->ev_known && header.mEventNumber <= n->ev_last) return; // replayed history
    n->ev_known = true;
    n->ev_last = header.mEventNumber;
    last_event_save(node_id, header.mEventNumber);
    if (now() < n->ev_ignore_until) return;

    const uint16_t ep = header.mPath.mEndpointId;
    const uint32_t event = header.mPath.mEventId;
    uint8_t presses = 0;
    if (data && event == Switch::Events::MultiPressComplete::Id) {
        Switch::Events::MultiPressComplete::DecodableType ev;
        if (chip::app::DataModel::Decode(*data, ev) == CHIP_NO_ERROR) presses = ev.totalNumberOfPressesCounted;
    }
    ESP_LOGI(TAG, "Node 0x%llx button %u: event %u (presses %u)", (unsigned long long)node_id, ep,
             (unsigned)event, presses);
    // Devices with multi-press (or action switches) report single presses as MultiPressComplete,
    // the others as ShortRelease.
    const bool multi = espm_controller_switch_features(node_id, ep) & (SWITCH_MULTI_PRESS | SWITCH_ACTION_SWITCH);
    switch (event) {
    case Switch::Events::ShortRelease::Id:
        if (!multi) fire(node_id, ep, ESPM_BUTTON_PRESS, false);
        break;
    case Switch::Events::MultiPressComplete::Id:
        if (presses == 1) fire(node_id, ep, ESPM_BUTTON_PRESS, false);
        else if (presses == 2) fire(node_id, ep, ESPM_BUTTON_DOUBLE, false);
        break;
    case Switch::Events::LongPress::Id: fire(node_id, ep, ESPM_BUTTON_HOLD, false); break;
    case Switch::Events::LongRelease::Id: fire(node_id, ep, ESPM_BUTTON_HOLD, true); break;
    default: break;
    }
}
#endif

uint32_t espm_controller_switch_features(uint64_t node, uint16_t endpoint)
{
    Node *n = find(node);
    if (!n) return 0;
    for (auto &e : n->eps) {
        if (e.id != endpoint) continue;
        for (int i = 0; i < N_ATTRS; i++)
            if (ATTRS[i].cluster == Switch::Id && (e.valid & (1u << i)) && !(e.null & (1u << i)))
                return (uint32_t)e.val[i];
    }
    return 0;
}

/** The endpoint, if the node has it (unlike endpoint_of, never adds it). */
static const Ep *lookup(uint64_t node, uint16_t endpoint)
{
    Node *n = find(node);
    if (n)
        for (auto &e : n->eps)
            if (e.id == endpoint) return &e;
    return nullptr;
}

bool espm_controller_has_endpoint(uint64_t node, uint16_t endpoint) { return lookup(node, endpoint); }

bool espm_controller_value(uint64_t node, uint16_t endpoint, const char *key, float *out)
{
    Node *n = find(node);
    const Ep *e = n && n->state == ONLINE ? lookup(node, endpoint) : nullptr;
    if (!e) return false;
    for (int i = 0; i < N_ATTRS; i++) {
        if (strcmp(ATTRS[i].key, key)) continue;
        if (!(e->valid & (1u << i)) || (e->null & (1u << i))) return false;
        *out = e->val[i];
        return true;
    }
    return false;
}

static void subscribe(Node &n)
{
    uint32_t mask = 0;
    for (auto &e : n.eps) mask |= e.has;
    const int battery_paths = n.power ? 2 : 0;
    int count = std::min(__builtin_popcount(mask), MAX_SUB_PATHS - battery_paths);
    ScopedMemoryBufferWithSize<AttributePathParams> paths;
    ScopedMemoryBufferWithSize<EventPathParams> events;
    paths.Alloc(count + battery_paths ? count + battery_paths : 1);
    if (!paths.Get()) return set_offline(n);
#if ESPM_CTRL_AUTOMATIONS
    // All button events of all endpoints, reported right away (urgent).
    if (has_switch(n)) {
        events.Alloc(1);
        if (!events.Get()) return set_offline(n);
        events[0] = EventPathParams(chip::kInvalidEndpointId, Switch::Id, chip::kInvalidEventId, true);
        if (!n.ev_known) n.ev_known = last_event_load(n.id, n.ev_last);
        // Without a stored event number old and new events look alike: skip the first reports.
        n.ev_ignore_until = n.ev_known ? 0 : now() + EVENT_PRIMING_S;
    }
#endif
    int k = 0;
    // One path per attribute with a wildcard endpoint: a relay with eight channels is one path.
    for (int i = 0; i < N_ATTRS && k < count; i++)
        if (mask & (1u << i))
            paths[k++] = AttributePathParams(chip::kInvalidEndpointId, ATTRS[i].cluster, ATTRS[i].attribute);
    // Battery, wherever the Power Source cluster is (mains-powered ones just don't answer).
    if (battery_paths) {
        paths[k++] = AttributePathParams(chip::kInvalidEndpointId, PowerSource::Id,
                                         PowerSource::Attributes::BatPercentRemaining::Id);
        paths[k++] =
            AttributePathParams(chip::kInvalidEndpointId, PowerSource::Id, PowerSource::Attributes::BatChargeLevel::Id);
    }
    if (!k) // nothing to show – subscribe anyway, to know whether the node is reachable
        paths[0] = AttributePathParams(0, Descriptor::Id, Descriptor::Attributes::DeviceTypeList::Id);
    if (__builtin_popcount(mask) > count)
        ESP_LOGW(TAG, "Node 0x%llx: following only %d of %d attributes", (unsigned long long)n.id, count,
                 __builtin_popcount(mask));

#if ESPM_CTRL_AUTOMATIONS
    controller::event_report_cb_t event_cb = on_sub_event;
#else
    controller::event_report_cb_t event_cb = nullptr;
#endif
    auto *cmd = chip::Platform::New<controller::subscribe_command>(n.id, std::move(paths), std::move(events), 1, 60,
                                                                   true, on_sub_attr, event_cb, on_sub_done,
                                                                   on_sub_failed, true);
    if (!cmd) return set_offline(n);
    n.sub = cmd;
    // On failure the command deletes itself.
    if (cmd->send_command() != ESP_OK && n.sub == cmd) set_offline(n);
}

static void on_read_attr(uint64_t node_id, const ConcreteDataAttributePath &path, chip::TLV::TLVReader *data)
{
    Node *n = find(node_id);
    if (!n || n->state != CONNECTING || n->sub) return;
    n->discovered = true;
    store(*n, path, data);
}

static void on_read_done(uint64_t node_id, const ScopedMemoryBufferWithSize<AttributePathParams> &,
                         const ScopedMemoryBufferWithSize<EventPathParams> &)
{
    Node *n = find(node_id);
    if (!n || n->state != CONNECTING || n->sub) return;
    if (!n->discovered) return set_offline(*n);
    subscribe(*n);
}

/** Read what the node is (device types and clusters per endpoint), then subscribe. */
static void discover(Node &n)
{
    n.state = CONNECTING;
    n.since = now();
    n.discovered = false;
    n.sub = nullptr;
    n.eps.clear();
    n.power = false;
    ScopedMemoryBufferWithSize<AttributePathParams> paths;
    ScopedMemoryBufferWithSize<EventPathParams> events;
    paths.Alloc(5);
    if (!paths.Get()) return set_offline(n);
    paths[0] = AttributePathParams(chip::kInvalidEndpointId, Descriptor::Id, Descriptor::Attributes::DeviceTypeList::Id);
    paths[1] = AttributePathParams(chip::kInvalidEndpointId, Descriptor::Id, Descriptor::Attributes::ServerList::Id);
    // What the device is, for the device list.
    paths[2] = AttributePathParams(0, BasicInformation::Id, BasicInformation::Attributes::VendorName::Id);
    paths[3] = AttributePathParams(0, BasicInformation::Id, BasicInformation::Attributes::ProductName::Id);
    paths[4] = AttributePathParams(0, BasicInformation::Id, BasicInformation::Attributes::SoftwareVersionString::Id);
    auto *cmd = chip::Platform::New<controller::read_command>(n.id, std::move(paths), std::move(events), on_read_attr,
                                                              on_read_done, nullptr);
    // A failed connection ends the read without a callback – tick() times it out.
    if (!cmd || cmd->send_command() != ESP_OK) set_offline(n);
}

static void on_diag_attr(uint64_t node_id, const ConcreteDataAttributePath &path, chip::TLV::TLVReader *data)
{
    Node *n = find(node_id);
    if (!n || n->state != ONLINE || !data || path.mEndpointId != 0) return;
    n->seen_at = now();
    for (int i = 0; i < N_DIAGS; i++) {
        if (DIAGS[i].cluster != path.mClusterId || DIAGS[i].attribute != path.mAttributeId) continue;
        double v;
        bool null;
        if (!read_number(*data, v, null)) return;
        if (null) n->diag_valid &= ~(1u << i);
        else {
            n->diag[i] = v;
            n->diag_valid |= 1u << i;
        }
        return;
    }
}

/** Read the node's diagnostics. A device without a cluster answers with a status – nothing stored. */
static void read_diagnostics(Node &n)
{
    ScopedMemoryBufferWithSize<AttributePathParams> paths;
    ScopedMemoryBufferWithSize<EventPathParams> events;
    paths.Alloc(N_DIAGS);
    if (!paths.Get()) return;
    for (int i = 0; i < N_DIAGS; i++) paths[i] = AttributePathParams(0, DIAGS[i].cluster, DIAGS[i].attribute);
    auto *cmd = chip::Platform::New<controller::read_command>(n.id, std::move(paths), std::move(events), on_diag_attr,
                                                              nullptr, nullptr);
    if (cmd) cmd->send_command(); // deletes itself when done or failed
}

static void pair_check_timeout();

static void tick(chip::System::Layer *, void *)
{
    pair_check_timeout();
    int64_t t = now();
    int connecting = 0, diag_reads = 0;
    for (auto &n : s_nodes)
        if (n.state == ONLINE && t >= n.diag_at && diag_reads < MAX_DIAG_READS_PER_TICK) {
            n.diag_at = t + DIAG_INTERVAL_S;
            read_diagnostics(n);
            diag_reads++;
        }
    for (auto &n : s_nodes) {
        if (n.state == CONNECTING && t - n.since > (n.sub ? 120 : 60)) set_offline(n);
        if (n.state == CONNECTING) connecting++;
    }
    if (espm_online())
        for (auto &n : s_nodes)
            if (connecting < MAX_CONNECTING && n.state == OFFLINE && t >= n.retry_at) {
                discover(n);
                connecting++;
            }
    chip::DeviceLayer::SystemLayer().StartTimer(chip::System::Clock::Seconds32(5), tick, nullptr);
}

// ---------------------------------------------------------------------------------------------
// Metric source: every node is a device of its own for exporters. An offline node reports only
// device.online = 0 (no stale values).
// ---------------------------------------------------------------------------------------------

static int metric_count()
{
    return espm_locked([] { return (int)s_nodes.size(); });
}

static void metric_report(int index, const espm_metric_sink_t *sink)
{
    espm_locked([&] {
        if (index < 0 || index >= (int)s_nodes.size()) return;
        Node &n = s_nodes[index];
        char id[64], node_id[24], labels[24];
        snprintf(node_id, sizeof(node_id), "%llu", (unsigned long long)n.id);
        snprintf(id, sizeof(id), "%s/node-%s", ESPM_DEVICE_ID, node_id);
        sink->device(sink->arg, id, n.name, node_id);
        sink->metric(sink->arg, "device.online", "", "1", n.state == ONLINE);
        if (n.state != ONLINE) return;
        for (int i = 0; i < N_DIAGS; i++)
            if (n.diag_valid & (1u << i)) sink->metric(sink->arg, DIAGS[i].metric, "", DIAGS[i].unit, n.diag[i]);
        for (auto &e : n.eps) {
            snprintf(labels, sizeof(labels), "endpoint=%u", e.id);
            for (int i = 0; i < N_ATTRS; i++)
                if (ATTRS[i].metric && (e.valid & (1u << i)) && !(e.null & (1u << i)))
                    sink->metric(sink->arg, ATTRS[i].metric, labels, ATTRS[i].unit, e.val[i]);
        }
    });
}

static const espm_metric_source_t s_metric_source = {metric_count, metric_report};

// ---------------------------------------------------------------------------------------------
// Commissioning
// ---------------------------------------------------------------------------------------------

/** Neither over Bluetooth (new devices) nor on the network (devices already in a network). */
static const char *const NOT_FOUND = "device not found – is it in pairing mode and near the hub?";

static void pair_failed(const char *why)
{
    s_pair_state = "failed";
    s_pair_error = why;
}

/** PASE result. On failure esp-matter has already dropped the pairing delegate, so it's over. */
static void on_pase(CHIP_ERROR err)
{
    if (err == CHIP_NO_ERROR) {
        s_pair_found = true;
        return;
    }
    if (strcmp(s_pair_state, "commissioning")) return;
    ESP_LOGW(TAG, "Pairing: no secure session with the device (%" CHIP_ERROR_FORMAT ")", err.Format());
    if (err == CHIP_ERROR_CANCELLED) pair_failed(NOT_FOUND);
    else pair_failed("the device refused the pairing code");
}

/** Called from tick(): give up a discovery that found nothing. */
static void pair_check_timeout()
{
    if (strcmp(s_pair_state, "commissioning") || s_pair_found || now() - s_pair_since < PAIR_DISCOVERY_TIMEOUT_S)
        return;
    ESP_LOGW(TAG, "Pairing: device not found within %d s, giving up", (int)PAIR_DISCOVERY_TIMEOUT_S);
    auto *commissioner = controller::matter_controller_client::get_instance().get_commissioner();
    // Ends in on_pase(CHIP_ERROR_CANCELLED); if it can't, free the commissioner ourselves.
    if (commissioner->StopPairing(s_pair_node) != CHIP_NO_ERROR) commissioner->RegisterPairingDelegate(nullptr);
    if (!strcmp(s_pair_state, "commissioning")) pair_failed(NOT_FOUND);
}

static void on_commissioned(chip::ScopedNodeId peer)
{
    s_nodes.push_back(make_node(peer.GetNodeId(), s_pair_name.empty() ? "Matter device" : s_pair_name.c_str()));
    save();
    s_pair_state = "done";
    ESP_LOGI(TAG, "Paired node 0x%llx", (unsigned long long)peer.GetNodeId());
    discover(s_nodes.back());
}

/** What went wrong, in the user's terms: the device was found and accepted the code by now. */
static const char *failure_text(chip::Controller::CommissioningStage stage,
                                std::optional<chip::Credentials::AttestationVerificationResult> attestation)
{
    using chip::Controller::CommissioningStage;
    using chip::Credentials::AttestationVerificationResult;
    if (attestation && *attestation != AttestationVerificationResult::kSuccess) {
        if (*attestation == AttestationVerificationResult::kPaaNotFound)
#if CONFIG_TEST_ATTESTATION_TRUST_STORE
            return "the device's certificate isn't a test certificate – set the hub's \"Device certificates\" "
                   "to certified products";
#else
            return "the device's certificate couldn't be checked – the hub needs internet access while "
                   "pairing (CSA registry)";
#endif
        return "the device's certificate was rejected";
    }
    switch (stage) {
    case CommissioningStage::kAttestationVerification:
    case CommissioningStage::kAttestationRevocationCheck:
        return "the device's certificate couldn't be checked";
    case CommissioningStage::kThreadNetworkSetup:
    case CommissioningStage::kThreadNetworkEnable:
        return "the device didn't accept the hub's Thread network";
    case CommissioningStage::kFindOperationalForStayActive:
    case CommissioningStage::kFindOperationalForCommissioningComplete:
        return "the device didn't show up in the hub's Thread network after joining – is it in range "
               "of the hub?";
    default:
        return "commissioning failed";
    }
}

static void on_failed(chip::ScopedNodeId, CHIP_ERROR err, chip::Controller::CommissioningStage stage,
                      std::optional<chip::Credentials::AttestationVerificationResult> attestation)
{
    pair_failed(failure_text(stage, attestation));
    ESP_LOGW(TAG, "Pairing failed at stage %d: %" CHIP_ERROR_FORMAT " (%s)", (int)stage, err.Format(),
             s_pair_error);
}

void espm_controller_start()
{
    load();
    espm_metrics_add_source(&s_metric_source);
    espm_locked([] {
        auto &client = controller::matter_controller_client::get_instance();
        client.init(112233, ESPM_CTRL_FABRIC_ID, 5580);
        client.setup_commissioner();
        chip::DeviceLayer::SystemLayer().StartTimer(chip::System::Clock::Seconds32(5), tick, nullptr);
    });
    controller::pairing_command_callbacks_t cbs = {on_pase, on_commissioned, on_failed};
    controller::pairing_command::get_instance().set_callbacks(cbs);
    ESP_LOGI(TAG, "Controller up, %d paired devices", (int)s_nodes.size());
}

// ---------------------------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------------------------

#if ESPM_HTTP
// Accounts: a node is the resource `n<id>`, its endpoint `n<id>.<ep>` (see espm_permission).
static espm_perm_t perm_of(uint64_t node, int endpoint = -1)
{
    char res[24];
    if (endpoint < 0) snprintf(res, sizeof(res), "n%llu", (unsigned long long)node);
    else snprintf(res, sizeof(res), "n%llu.%d", (unsigned long long)node, endpoint);
    return espm_permission(res);
}

static const char *PERM_NAMES[] = {"none", "read", "write"};

/** Every node the caller may see, each with only the endpoints it may see and `access` per endpoint. */
/** Tags, what the device is, battery and when it was last heard from. */
static void add_info(cJSON *o, const Node &n)
{
    cJSON *tags = cJSON_AddArrayToObject(o, "tags");
    for (const char *p = n.tags; *p;) {
        const char *end = strchr(p, ',');
        size_t len = end ? (size_t)(end - p) : strlen(p);
        std::string tag(p, len);
        if (!tag.empty()) cJSON_AddItemToArray(tags, cJSON_CreateString(tag.c_str()));
        p += len + (end ? 1 : 0);
    }
    if (n.vendor[0]) cJSON_AddStringToObject(o, "vendor", n.vendor);
    if (n.product[0]) cJSON_AddStringToObject(o, "product", n.product);
    if (n.sw[0]) cJSON_AddStringToObject(o, "softwareVersion", n.sw);
    if (n.battery >= 0) cJSON_AddNumberToObject(o, "battery", n.battery);
    if (n.charge >= 0) cJSON_AddStringToObject(o, "batteryLevel", CHARGE_NAMES[n.charge]);
    // Stamped with the uptime: how long ago, and the time once the clock is set (never 1970).
    if (n.seen_at) {
        int64_t ago = now() - n.seen_at;
        cJSON_AddNumberToObject(o, "lastSeenAgo", (double)ago);
        time_t t = time(nullptr);
        if (t > 1700000000) cJSON_AddNumberToObject(o, "lastSeen", (double)(t - ago));
    }
}

static esp_err_t list(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON *nodes = cJSON_AddArrayToObject(json, "nodes");
    bool admin = espm_caller_admin();
    lock::ScopedChipStackLock guard(portMAX_DELAY); // the Matter task writes s_nodes
    for (auto &n : s_nodes) {
        char res[24];
        snprintf(res, sizeof(res), "n%llu", (unsigned long long)n.id);
        // A user sees a node with a grant on it, or on one of its endpoints.
        if (!espm_permission_any(res)) continue;
        espm_perm_t node_perm = espm_permission(res);
        cJSON *o = cJSON_CreateObject();
        cJSON_AddNumberToObject(o, "id", (double)n.id);
        cJSON_AddStringToObject(o, "name", n.name);
        cJSON_AddStringToObject(o, "state", STATE_NAMES[n.state]);
        cJSON_AddBoolToObject(o, "online", n.state == ONLINE);
        if (!admin) cJSON_AddStringToObject(o, "access", PERM_NAMES[node_perm]);
        add_info(o, n);
        if (n.diag_valid && node_perm) {
            cJSON *d = cJSON_AddObjectToObject(o, "diagnostics");
            for (int i = 0; i < N_DIAGS; i++)
                if (n.diag_valid & (1u << i)) cJSON_AddNumberToObject(d, DIAGS[i].key, n.diag[i]);
        }
        cJSON *eps = cJSON_AddArrayToObject(o, "endpoints");
        for (auto &e : n.eps) {
            espm_perm_t ep_perm = perm_of(n.id, e.id);
            if (!ep_perm) continue;
            cJSON *eo = cJSON_CreateObject();
            cJSON_AddNumberToObject(eo, "id", e.id);
            if (!admin) cJSON_AddStringToObject(eo, "access", PERM_NAMES[ep_perm]);
            cJSON *types = cJSON_AddArrayToObject(eo, "deviceTypes");
            for (int i = 0; i < e.ntypes; i++) cJSON_AddItemToArray(types, cJSON_CreateNumber(e.types[i]));
            cJSON *clusters = cJSON_AddArrayToObject(eo, "clusters");
            for (int i = 0; i < e.nclusters; i++)
                cJSON_AddItemToArray(clusters, cJSON_CreateNumber(e.clusters[i]));
            for (int i = 0; i < N_ATTRS; i++) {
                if (!(e.valid & (1u << i))) continue;
                if (e.null & (1u << i)) cJSON_AddNullToObject(eo, ATTRS[i].key);
                else if (ATTRS[i].kind == K_BOOL || ATTRS[i].kind == K_BIT)
                    cJSON_AddBoolToObject(eo, ATTRS[i].key, e.val[i] != 0);
                else cJSON_AddNumberToObject(eo, ATTRS[i].key, round(e.val[i] * 100) / 100);
            }
            cJSON_AddItemToArray(eps, eo);
        }
        cJSON_AddItemToArray(nodes, o);
    }
    return espm_send_json(req, json);
}

static esp_err_t pair(httpd_req_t *req)
{
    if (s_nodes.size() >= ESPM_CTRL_MAX_NODES) return espm_send_error(req, 409, "device limit reached");
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *code = cJSON_GetObjectItem(body, "code");
    cJSON *name = cJSON_GetObjectItem(body, "name");
    if (!cJSON_IsString(code)) {
        cJSON_Delete(body);
        return espm_send_error(req, 400, "code is required");
    }
    std::string payload = code->valuestring;
    // Dashes only group manual codes; in a QR payload they're data.
    if (payload.rfind("MT:", 0) != 0) payload.erase(std::remove(payload.begin(), payload.end(), '-'), payload.end());
    s_pair_name = cJSON_IsString(name) ? name->valuestring : "";
    cJSON_Delete(body);

    if (!strcmp(s_pair_state, "commissioning")) return espm_send_error(req, 409, "pairing already in progress");
    // The device's certificates are issued from now on: with the clock at 1970 commissioning fails.
    if (time(nullptr) < 1700000000)
        return espm_send_error(req, 503, "the hub's clock is not set yet (no answer from the NTP server)");
    chip::SetupPayload parsed;
    if (chip::ManualSetupPayloadParser(payload).populatePayload(parsed) != CHIP_NO_ERROR &&
        chip::QRCodeSetupPayloadParser(payload).populatePayload(parsed) != CHIP_NO_ERROR)
        return espm_send_error(req, 400, "invalid pairing code");

    s_pair_node = s_next_id++;
    s_pair_state = "commissioning";
    s_pair_error = "";
    s_pair_since = now();
    s_pair_found = false;
    // With a Thread network: look for the device over BLE and the network, and hand a new device
    // the network's credentials. Without: only devices already on the network.
    static uint8_t dataset[254];
    size_t dataset_len = espm_otbr_dataset ? espm_otbr_dataset(dataset, sizeof(dataset)) : 0;
    ESP_LOGI(TAG, "Pairing node 0x%llx %s", (unsigned long long)s_pair_node,
             dataset_len ? "over BLE or the network (Thread credentials)" : "on the network only");
    uint64_t previous = s_pair_node - 1;
    esp_err_t err = espm_locked([&] {
        // A finished pairing that never released the commissioner (seen after a failed attempt):
        // nothing runs any more (s_pair_state isn't "commissioning"), so take it back.
        auto *commissioner = controller::matter_controller_client::get_instance().get_commissioner();
        if (commissioner->GetPairingDelegate()) {
            ESP_LOGW(TAG, "Pairing: releasing the commissioner from a previous attempt");
            commissioner->StopPairing(previous);
            commissioner->RegisterPairingDelegate(nullptr);
        }
        return dataset_len ? controller::pairing_code_thread(s_pair_node, payload.c_str(), dataset, dataset_len)
                           : controller::pairing_code(s_pair_node, payload.c_str());
    });
    if (err != ESP_OK) {
        pair_failed("the controller is busy");
        return espm_send_error(req, 409, "the controller is busy – try again in a minute");
    }
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", true);
    cJSON_AddNumberToObject(json, "nodeId", (double)s_pair_node);
    return espm_send_json(req, json);
}

static esp_err_t pair_state(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "state", s_pair_state);
    if (s_pair_error[0]) cJSON_AddStringToObject(json, "error", s_pair_error);
    cJSON_AddNumberToObject(json, "nodeId", (double)s_pair_node);
    return espm_send_json(req, json);
}

static uint64_t number(cJSON *body, const char *key)
{
    cJSON *v = cJSON_GetObjectItem(body, key);
    return cJSON_IsNumber(v) && v->valuedouble >= 0 ? (uint64_t)v->valuedouble : UINT64_MAX;
}

static esp_err_t invoke(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    uint64_t node = number(body, "node"), endpoint = number(body, "endpoint"), cluster = number(body, "cluster"),
             command = number(body, "command"), timed = number(body, "timedMs");
    cJSON *data = cJSON_GetObjectItem(body, "data");
    char *fields = cJSON_IsObject(data) ? cJSON_PrintUnformatted(data) : nullptr;
    cJSON_Delete(body);
    if (node == UINT64_MAX || endpoint == UINT64_MAX || cluster == UINT64_MAX || command == UINT64_MAX) {
        cJSON_free(fields);
        return espm_send_error(req, 400, "node, endpoint, cluster and command are required");
    }
    if (endpoint > 0xFFFF || perm_of(node, (int)endpoint) != ESPM_PERM_WRITE) {
        cJSON_free(fields);
        return espm_send_error(req, 403, "no write access to this device");
    }
    chip::Optional<uint16_t> timeout;
    if (timed != UINT64_MAX) timeout.SetValue((uint16_t)std::min<uint64_t>(timed, 60000));
    esp_err_t err = espm_locked(
        [&] { return controller::send_invoke_cluster_command(node, endpoint, cluster, command, fields, timeout); });
    cJSON_free(fields);
    return err == ESP_OK ? espm_send_ok(req) : espm_send_error(req, 502, "command failed");
}

static esp_err_t write_attr(httpd_req_t *req)
{
    static const char *TYPES[] = {"BOOL", "U8", "U16", "U32", "U64", "I8", "I16", "I32", "I64", "FP", "DFP"};
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    uint64_t node = number(body, "node"), endpoint = number(body, "endpoint"), cluster = number(body, "cluster"),
             attribute = number(body, "attribute");
    cJSON *type = cJSON_GetObjectItem(body, "type");
    cJSON *value = cJSON_GetObjectItem(body, "value");
    bool known = cJSON_IsString(type) &&
                 std::any_of(std::begin(TYPES), std::end(TYPES), [&](const char *t) { return !strcmp(t, type->valuestring); });
    if (node == UINT64_MAX || endpoint == UINT64_MAX || cluster == UINT64_MAX || attribute == UINT64_MAX || !known ||
        !(cJSON_IsNumber(value) || cJSON_IsBool(value) || cJSON_IsNull(value))) {
        cJSON_Delete(body);
        return espm_send_error(req, 400, "node, endpoint, cluster, attribute, type and value are required");
    }
    if (endpoint > 0xFFFF || perm_of(node, (int)endpoint) != ESPM_PERM_WRITE) {
        cJSON_Delete(body);
        return espm_send_error(req, 403, "no write access to this device");
    }
    // esp-matter's format: an object whose single field is the value, e.g. {"0:U8": 4}.
    std::string key = std::string("0:") + (cJSON_IsNull(value) ? "NULL" : type->valuestring);
    cJSON *wrapped = cJSON_CreateObject();
    cJSON_AddItemToObject(wrapped, key.c_str(), cJSON_Duplicate(value, false));
    char *json = cJSON_PrintUnformatted(wrapped);
    cJSON_Delete(wrapped);
    cJSON_Delete(body);
    esp_err_t err =
        espm_locked([&] { return controller::send_write_attr_command(node, endpoint, cluster, attribute, json); });
    cJSON_free(json);
    return err == ESP_OK ? espm_send_ok(req) : espm_send_error(req, 502, "write failed");
}

static void on_fabric_removed(chip::NodeId node, CHIP_ERROR err)
{
    if (err == CHIP_NO_ERROR) ESP_LOGI(TAG, "Node 0x%llx left the hub's fabric", (unsigned long long)node);
    else
        ESP_LOGW(TAG, "Node 0x%llx not reached (%" CHIP_ERROR_FORMAT ") – factory-reset it to pair it again",
                 (unsigned long long)node, err.Format());
}

static esp_err_t remove(httpd_req_t *req)
{
    uint64_t id = strtoull(strrchr(req->uri, '/') + 1, nullptr, 10);
    espm_locked([&] {
        // Ask the device to leave our fabric; it's forgotten here either way.
        controller::auto_fabric_remover::remove_fabric(
            controller::matter_controller_client::get_instance().get_commissioner(), id, on_fabric_removed);
        if (Node *n = find(id)) {
            n->tags[0] = 0;
            tags_save(*n);
        }
        s_nodes.erase(std::remove_if(s_nodes.begin(), s_nodes.end(), [&](const Node &n) { return n.id == id; }),
                      s_nodes.end());
        save();
#if ESPM_CTRL_AUTOMATIONS
        last_event_forget(id);
#endif
        if (espm_automations_node_removed) espm_automations_node_removed(id);
    });
    char res[24];
    snprintf(res, sizeof(res), "n%llu", (unsigned long long)id);
    espm_permissions_forget(res);
    return espm_send_ok(req);
}

/** Rename a node and/or set its tags. */
static esp_err_t update(httpd_req_t *req)
{
    uint64_t id = strtoull(strrchr(req->uri, '/') + 1, nullptr, 10);
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *name = cJSON_GetObjectItem(body, "name");
    cJSON *tags = cJSON_GetObjectItem(body, "tags");
    std::string joined;
    const char *error = nullptr;
    if (name && (!cJSON_IsString(name) || !name->valuestring[0] || strlen(name->valuestring) > 31))
        error = "name needs 1–31 characters";
    if (cJSON_IsArray(tags)) {
        cJSON *t;
        cJSON_ArrayForEach(t, tags)
        {
            if (!cJSON_IsString(t) || !t->valuestring[0] || strlen(t->valuestring) > MAX_TAG_LEN ||
                strchr(t->valuestring, ',')) {
                error = "tags need 1–24 characters, no commas";
                break;
            }
            if (!joined.empty()) joined += ',';
            joined += t->valuestring;
        }
        if (!error && joined.size() >= sizeof(Node::tags)) error = "too many tags";
    } else if (tags) {
        error = "tags must be a list";
    }
    std::string new_name = cJSON_IsString(name) ? name->valuestring : "";
    cJSON_Delete(body);
    if (error) return espm_send_error(req, 400, error);
    bool found = espm_locked([&] {
        Node *n = find(id);
        if (!n) return false;
        if (!new_name.empty()) {
            strlcpy(n->name, new_name.c_str(), sizeof(n->name));
            save();
        }
        if (tags) {
            strlcpy(n->tags, joined.c_str(), sizeof(n->tags));
            tags_save(*n);
        }
        return true;
    });
    return found ? espm_send_ok(req) : espm_send_error(req, 404, "no such device");
}

struct ControllerRoutes {
    ControllerRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/controller/nodes", list, ESPM_ACCOUNT);
        espm_route(HTTP_POST, "/api/v1/controller/pair", pair);
        espm_route(HTTP_GET, "/api/v1/controller/pair", pair_state);
        espm_route(HTTP_POST, "/api/v1/controller/invoke", invoke, ESPM_ACCOUNT);
        espm_route(HTTP_POST, "/api/v1/controller/write", write_attr, ESPM_ACCOUNT);
        espm_route(HTTP_PUT, "/api/v1/controller/nodes/*", update);
        espm_route(HTTP_DELETE, "/api/v1/controller/nodes/*", remove);
    }
};
static ControllerRoutes s_routes;
#endif
