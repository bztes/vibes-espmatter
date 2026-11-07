// espmatter studio – Matter controller automations: a trigger (a button of a Matter switch, a time
// of day, once at a set time, a value crossing a threshold) runs actions (commands and attribute writes to endpoints, scenes).
//
// Every account makes its own; they run with the owner's current access, so a lost grant stops
// the actions it covered. Each rule is a JSON document in NVS (`r<id>`): new trigger, condition and
// action types are new `type`s or fields, and rules of unknown types are kept but never run.
// Rules are only touched with the Matter stack lock held.
#include "espm.h"
#include "espm_automations.h"
#include "espm_controller.h"

#include <string.h>
#include <string>
#include <time.h>
#include <vector>
#include <algorithm>
#include <esp_log.h>
#include <esp_timer.h>
#include <nvs.h>
#include <app-common/zap-generated/cluster-objects.h>
#include <esp_matter_controller_cluster_command.h>
#include <esp_matter_controller_write_command.h>
#include <platform/CHIPDeviceLayer.h>

using namespace esp_matter;
using namespace chip::app::Clusters;

static const char *TAG = "espm_auto";
static const char *NS = "espm_rules";

static constexpr size_t MAX_RULES = 32;
static constexpr size_t MAX_ACTIONS = 12;
static constexpr size_t MAX_STORED = 4000; // NVS string limit, with the terminator
static constexpr int NAME_LEN = 32;

enum TriggerType : uint8_t { T_UNKNOWN, T_BUTTON, T_TIME, T_ONCE, T_VALUE };
enum : uint8_t { CMP_BELOW = 1, CMP_ABOVE };
enum ActionType : uint8_t { A_UNKNOWN, A_ENDPOINT, A_SCENE, A_INVOKE, A_WRITE };

enum : uint8_t {
    CMD_TOGGLE = 1,
    CMD_ON,
    CMD_OFF,
    CMD_BRIGHTER,
    CMD_DARKER,
    CMD_WARMER,
    CMD_COOLER,
    CMD_DIM_UP,      // while held
    CMD_DIM_DOWN,    // while held
    CMD_WARMER_HOLD, // while held
    CMD_COOLER_HOLD, // while held
    CMD_LEVEL,       // to `value`
    CMD_ACTIVATE,    // scenes
};

struct Trigger {
    TriggerType type;
    uint8_t gesture; // button: espm_button_t
    uint8_t days;    // time: bit 0 Sunday … bit 6 Saturday
    uint16_t minute; // time: of the day, local time
    uint64_t node;   // button, value
    uint16_t ep;
    int64_t at; // once: Unix time
    char key[24]; // value: the followed attribute (`temperature`, `stateValue` …)
    uint8_t cmp;  // value: CMP_BELOW / CMP_ABOVE
    float threshold;
    float hysteresis; // value: how far back past the threshold before it can fire again
    uint32_t for_s;   // value: how long the condition must hold
};

/** Where a value rule stands; not stored – after boot, edits and reconnects it starts unknown. */
enum : uint8_t { V_UNKNOWN, V_ARMED, V_PENDING, V_DONE };

struct Action {
    ActionType type;
    uint8_t command;
    uint8_t value;  // CMD_LEVEL: 1–254
    uint16_t scene; // A_SCENE
    uint64_t node;  // A_ENDPOINT, A_INVOKE, A_WRITE
    uint16_t ep;
    uint32_t cluster;   // A_INVOKE, A_WRITE
    uint32_t id;        // command or attribute
    uint16_t timed_ms;  // 0: not timed
    std::string data;   // esp-matter JSON: command fields, or the written value ({"0:U8":4})
    std::string preset; // the app's name for it, kept as given
    double arg;         // the value the user picked, kept as given
    bool has_arg;
};

struct Rule {
    uint16_t id;
    int owner;
    bool enabled;
    char name[NAME_LEN];
    Trigger trigger;
    std::vector<Action> actions; // only what's used
    uint8_t vstate;
    int64_t vsince; // V_PENDING: s (esp_timer) the condition holds since
};

struct Named {
    uint8_t id;
    const char *name;
};
static const Named TRIGGERS[] = {{T_BUTTON, "button"}, {T_TIME, "time"}, {T_ONCE, "once"}, {T_VALUE, "value"}};
static const Named ACTION_TYPES[] = {
    {A_ENDPOINT, "endpoint"}, {A_SCENE, "scene"}, {A_INVOKE, "invoke"}, {A_WRITE, "write"}};
static const char *VALUE_TYPES[] = {"BOOL", "U8", "U16", "U32", "U64", "I8", "I16", "I32", "I64", "FP", "DFP", "NULL"};
static constexpr size_t MAX_DATA = 160;
static const Named GESTURES[] = {{ESPM_BUTTON_PRESS, "press"}, {ESPM_BUTTON_DOUBLE, "double"}, {ESPM_BUTTON_HOLD, "hold"}};
static const Named ENDPOINT_CMDS[] = {
    {CMD_TOGGLE, "toggle"},         {CMD_ON, "on"},           {CMD_OFF, "off"},
    {CMD_BRIGHTER, "brighter"},     {CMD_DARKER, "darker"},   {CMD_WARMER, "warmer"},
    {CMD_COOLER, "cooler"},         {CMD_DIM_UP, "dim_up"},   {CMD_DIM_DOWN, "dim_down"},
    {CMD_WARMER_HOLD, "warmer_hold"}, {CMD_COOLER_HOLD, "cooler_hold"}, {CMD_LEVEL, "level"},
};
static const Named SCENE_CMDS[] = {{CMD_ACTIVATE, "activate"}};

template <size_t N> static const char *name_of(const Named (&list)[N], uint8_t id)
{
    for (const auto &e : list)
        if (e.id == id) return e.name;
    return "?";
}

template <size_t N> static uint8_t id_of(const Named (&list)[N], const char *name)
{
    for (const auto &e : list)
        if (name && !strcmp(name, e.name)) return e.id;
    return 0;
}

static bool is_continuous(uint8_t cmd)
{
    return cmd == CMD_DIM_UP || cmd == CMD_DIM_DOWN || cmd == CMD_WARMER_HOLD || cmd == CMD_COOLER_HOLD;
}

/** Sends to one endpoint (commands, writes). */
static bool to_endpoint(const Action &a) { return a.type == A_ENDPOINT || a.type == A_INVOKE || a.type == A_WRITE; }

static std::vector<Rule> s_rules;
static uint16_t s_next_id = 1;

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

bool espm_auto_allowed(int user, uint64_t node, uint16_t endpoint, espm_perm_t need)
{
    if (user == 0) return true;
#if ESPM_USERS
    char res[24];
    snprintf(res, sizeof(res), "n%llu.%u", (unsigned long long)node, endpoint);
    return espm_users_permission(user, res) >= need; // admins: write; deleted accounts: none
#else
    return false;
#endif
}

#if ESPM_HTTP
int espm_auto_caller()
{
    int user = espm_caller_user();
    return user < 0 ? 0 : user;
}
#endif

static bool owner_exists(int owner)
{
#if ESPM_USERS
    return owner == 0 || espm_users_role(owner) >= 0;
#else
    return owner == 0;
#endif
}

/** Why the action can't run (its owner's access), or null. */
static const char *action_problem(int owner, const Action &a)
{
    switch (a.type) {
    case A_ENDPOINT:
    case A_INVOKE:
    case A_WRITE:
        return espm_auto_allowed(owner, a.node, a.ep, ESPM_PERM_WRITE) ? nullptr : "no access to the device any more";
    case A_SCENE:
        if (!a.command) return "scenes can no longer be deactivated";
        return espm_scene_usable(owner, a.scene) ? nullptr : "the scene is gone or no longer shared";
    default: return "made by a newer firmware";
    }
}

/** Why the rule doesn't run, or null. */
static const char *problem(const Rule &r)
{
    if (!owner_exists(r.owner)) return "its account was deleted";
    if (r.trigger.type == T_UNKNOWN) return "made by a newer firmware";
    if (r.trigger.type == T_BUTTON && !espm_auto_allowed(r.owner, r.trigger.node, r.trigger.ep, ESPM_PERM_READ))
        return "no access to the button any more";
    if (r.trigger.type == T_VALUE && !espm_auto_allowed(r.owner, r.trigger.node, r.trigger.ep, ESPM_PERM_READ))
        return "no access to the sensor any more";
    for (const Action &a : r.actions)
        if (const char *p = action_problem(r.owner, a)) return p;
    if ((r.trigger.type == T_TIME || r.trigger.type == T_ONCE) && !espm_time_valid())
        return "the hub's clock is not set yet";
    if (r.trigger.type == T_ONCE && r.trigger.at / 60 < time(nullptr) / 60) return "its time has passed";
    return nullptr;
}

// ---------------------------------------------------------------------------------------------
// JSON – the stored documents and the API share it
// ---------------------------------------------------------------------------------------------

static bool get_uint(cJSON *o, const char *key, double max, uint64_t &out)
{
    cJSON *v = cJSON_GetObjectItem(o, key);
    if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > max) return false;
    out = (uint64_t)v->valuedouble;
    return true;
}

static cJSON *trigger_json(const Trigger &t)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", t.type == T_UNKNOWN ? "unknown" : name_of(TRIGGERS, t.type));
    if (t.type == T_BUTTON) {
        cJSON_AddNumberToObject(o, "node", (double)t.node);
        cJSON_AddNumberToObject(o, "endpoint", t.ep);
        cJSON_AddStringToObject(o, "gesture", name_of(GESTURES, t.gesture));
    } else if (t.type == T_TIME) {
        cJSON_AddNumberToObject(o, "minute", t.minute);
        cJSON_AddNumberToObject(o, "days", t.days);
    } else if (t.type == T_ONCE) {
        cJSON_AddNumberToObject(o, "at", (double)t.at);
    } else if (t.type == T_VALUE) {
        cJSON_AddNumberToObject(o, "node", (double)t.node);
        cJSON_AddNumberToObject(o, "endpoint", t.ep);
        cJSON_AddStringToObject(o, "key", t.key);
        cJSON_AddNumberToObject(o, t.cmp == CMP_BELOW ? "below" : "above", t.threshold);
        if (t.hysteresis > 0) cJSON_AddNumberToObject(o, "hysteresis", t.hysteresis);
        if (t.for_s) cJSON_AddNumberToObject(o, "for", t.for_s);
    }
    return o;
}

static cJSON *action_json(const Action &a)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "type", a.type == A_UNKNOWN ? "unknown" : name_of(ACTION_TYPES, a.type));
    if (a.type == A_ENDPOINT) {
        cJSON_AddNumberToObject(o, "node", (double)a.node);
        cJSON_AddNumberToObject(o, "endpoint", a.ep);
        cJSON_AddStringToObject(o, "command", name_of(ENDPOINT_CMDS, a.command));
        if (a.command == CMD_LEVEL) cJSON_AddNumberToObject(o, "level", a.value);
    } else if (a.type == A_SCENE) {
        cJSON_AddNumberToObject(o, "scene", a.scene);
        cJSON_AddStringToObject(o, "command", name_of(SCENE_CMDS, a.command));
    } else if (a.type == A_INVOKE || a.type == A_WRITE) {
        cJSON_AddNumberToObject(o, "node", (double)a.node);
        cJSON_AddNumberToObject(o, "endpoint", a.ep);
        cJSON_AddNumberToObject(o, "cluster", a.cluster);
        cJSON *data = cJSON_Parse(a.data.c_str());
        if (a.type == A_INVOKE) {
            cJSON_AddNumberToObject(o, "command", a.id);
            if (data) cJSON_AddItemToObject(o, "data", data);
        } else {
            // Stored as {"0:<type>": value}.
            cJSON_AddNumberToObject(o, "attribute", a.id);
            cJSON *v = data ? data->child : nullptr;
            if (v) {
                cJSON_AddStringToObject(o, "valueType", v->string + 2);
                cJSON_AddItemToObject(o, "value", cJSON_Duplicate(v, false));
            }
            cJSON_Delete(data);
        }
        if (a.timed_ms) cJSON_AddNumberToObject(o, "timedMs", a.timed_ms);
        if (!a.preset.empty()) cJSON_AddStringToObject(o, "preset", a.preset.c_str());
        if (a.has_arg) cJSON_AddNumberToObject(o, "arg", a.arg);
    }
    return o;
}

static cJSON *rule_json(const Rule &r)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "id", r.id);
    cJSON_AddStringToObject(o, "name", r.name);
    cJSON_AddBoolToObject(o, "enabled", r.enabled);
    cJSON_AddNumberToObject(o, "owner", r.owner);
    cJSON_AddItemToObject(o, "trigger", trigger_json(r.trigger));
    cJSON *list = cJSON_AddArrayToObject(o, "actions");
    for (const Action &a : r.actions) cJSON_AddItemToArray(list, action_json(a));
    return o;
}

/** Unknown types are kept as such (`strict`: rejected, for requests). */
static const char *parse_trigger(cJSON *o, Trigger &t, bool strict)
{
    if (!cJSON_IsObject(o)) return "trigger is required";
    t = {};
    t.type = (TriggerType)id_of(TRIGGERS, cJSON_GetStringValue(cJSON_GetObjectItem(o, "type")));
    uint64_t n;
    switch (t.type) {
    case T_BUTTON:
        if (!get_uint(o, "node", 1e15, t.node) || !get_uint(o, "endpoint", 0xFFFE, n))
            return "a button trigger needs node and endpoint";
        t.ep = n;
        t.gesture = id_of(GESTURES, cJSON_GetStringValue(cJSON_GetObjectItem(o, "gesture")));
        if (!t.gesture) return "gesture: press, double or hold";
        return nullptr;
    case T_TIME:
        if (!get_uint(o, "minute", 24 * 60 - 1, n)) return "minute: 0–1439 (of the day)";
        t.minute = n;
        if (!get_uint(o, "days", 0x7F, n) || !n) return "days: pick at least one";
        t.days = n;
        return nullptr;
    case T_ONCE:
        // `in` (minutes from now, by the hub's clock) only in requests; stored is `at`.
        if (strict && get_uint(o, "in", 7 * 24 * 60, n)) {
            if (!espm_time_valid()) return "the hub's clock is not set yet";
            if (!n) return "in: at least 1 minute";
            t.at = (time(nullptr) / 60 + n) * 60;
        } else if (get_uint(o, "at", 1e11, n) && n > 1600000000) {
            t.at = n;
        } else {
            return "a once trigger needs at (Unix time) or in (minutes)";
        }
        if (strict && espm_time_valid() && t.at / 60 <= time(nullptr) / 60) return "that time has passed";
        return nullptr;
    case T_VALUE: {
        if (!get_uint(o, "node", 1e15, t.node) || !get_uint(o, "endpoint", 0xFFFE, n))
            return "a value trigger needs node and endpoint";
        t.ep = n;
        const char *key = cJSON_GetStringValue(cJSON_GetObjectItem(o, "key"));
        if (!key || !*key || strlen(key) >= sizeof(t.key)) return "key: the value to watch, e.g. temperature";
        strlcpy(t.key, key, sizeof(t.key));
        cJSON *below = cJSON_GetObjectItem(o, "below"), *above = cJSON_GetObjectItem(o, "above");
        if (cJSON_IsNumber(below) == cJSON_IsNumber(above)) return "a value trigger needs below or above";
        t.cmp = cJSON_IsNumber(below) ? CMP_BELOW : CMP_ABOVE;
        t.threshold = (cJSON_IsNumber(below) ? below : above)->valuedouble;
        if (cJSON *h = cJSON_GetObjectItem(o, "hysteresis")) {
            if (!cJSON_IsNumber(h) || h->valuedouble < 0) return "hysteresis: 0 or more";
            t.hysteresis = h->valuedouble;
        }
        if (cJSON_GetObjectItem(o, "for")) {
            if (!get_uint(o, "for", 86400, n)) return "for: 0–86400 seconds";
            t.for_s = n;
        }
        return nullptr;
    }
    default: return strict ? "trigger type: button, time, once or value" : nullptr;
    }
}

/** An invoke or write action: what to send, plus the app's preset and arg. */
static const char *parse_request(cJSON *o, Action &a)
{
    uint64_t n;
    const bool invoke = a.type == A_INVOKE;
    if (!get_uint(o, "node", 1e15, a.node) || !get_uint(o, "endpoint", 0xFFFE, n))
        return "the action needs node and endpoint";
    a.ep = n;
    if (!get_uint(o, "cluster", 0xFFFFFFFF, n)) return "the action needs cluster";
    a.cluster = n;
    if (!get_uint(o, invoke ? "command" : "attribute", 0xFFFFFFFF, n))
        return invoke ? "an invoke action needs command" : "a write action needs attribute";
    a.id = n;
    if (cJSON_GetObjectItem(o, "timedMs")) {
        if (!get_uint(o, "timedMs", 60000, n)) return "timedMs: up to 60000";
        a.timed_ms = n;
    }
    cJSON *data;
    if (invoke) {
        cJSON *fields = cJSON_GetObjectItem(o, "data");
        if (fields && !cJSON_IsObject(fields)) return "data: an object of fields, e.g. {\"0:U8\": 4}";
        data = fields ? cJSON_Duplicate(fields, true) : nullptr;
    } else {
        const char *type = cJSON_GetStringValue(cJSON_GetObjectItem(o, "valueType"));
        cJSON *value = cJSON_GetObjectItem(o, "value");
        bool known = type && std::any_of(std::begin(VALUE_TYPES), std::end(VALUE_TYPES),
                                         [&](const char *t) { return !strcmp(t, type); });
        if (!known || !(cJSON_IsNumber(value) || cJSON_IsBool(value) || cJSON_IsNull(value)))
            return "a write action needs valueType (e.g. U8) and value";
        std::string key = std::string("0:") + (cJSON_IsNull(value) ? "NULL" : type);
        data = cJSON_CreateObject();
        cJSON_AddItemToObject(data, key.c_str(), cJSON_Duplicate(value, false));
    }
    if (data) {
        char *text = cJSON_PrintUnformatted(data);
        cJSON_Delete(data);
        if (!text) return "out of memory";
        a.data = text;
        cJSON_free(text);
        if (a.data.size() > MAX_DATA) return "data: too long";
    }
    if (const char *preset = cJSON_GetStringValue(cJSON_GetObjectItem(o, "preset"))) {
        if (strlen(preset) > 31) return "preset: up to 31 characters";
        a.preset = preset;
    }
    cJSON *arg = cJSON_GetObjectItem(o, "arg");
    a.has_arg = cJSON_IsNumber(arg);
    if (a.has_arg) a.arg = arg->valuedouble;
    return nullptr;
}

static const char *parse_action(cJSON *o, Action &a, bool strict)
{
    if (!cJSON_IsObject(o)) return "invalid action";
    a = {};
    a.type = (ActionType)id_of(ACTION_TYPES, cJSON_GetStringValue(cJSON_GetObjectItem(o, "type")));
    const char *cmd = cJSON_GetStringValue(cJSON_GetObjectItem(o, "command"));
    uint64_t n;
    switch (a.type) {
    case A_ENDPOINT:
        if (!get_uint(o, "node", 1e15, a.node) || !get_uint(o, "endpoint", 0xFFFE, n))
            return "an endpoint action needs node and endpoint";
        a.ep = n;
        a.command = id_of(ENDPOINT_CMDS, cmd);
        if (!a.command) return "unknown command";
        if (a.command == CMD_LEVEL) {
            if (!get_uint(o, "level", 254, n) || !n) return "level: 1–254";
            a.value = n;
        }
        return nullptr;
    case A_SCENE:
        if (!get_uint(o, "scene", 0xFFFF, n)) return "a scene action needs scene";
        a.scene = n;
        a.command = id_of(SCENE_CMDS, cmd);
        // Stored ones from before (deactivate) are kept, and reported.
        return a.command || !strict ? nullptr : "command: activate";
    case A_INVOKE:
    case A_WRITE: return parse_request(o, a);
    default: return strict ? "action type: endpoint, invoke, write or scene" : nullptr;
    }
}

static const char *parse_actions(cJSON *list, Rule &r, bool strict)
{
    if (!cJSON_IsArray(list) || !cJSON_GetArraySize(list)) return "actions: at least one";
    if (cJSON_GetArraySize(list) > (int)MAX_ACTIONS) return "actions: at most 12";
    r.actions.clear();
    cJSON *item;
    cJSON_ArrayForEach(item, list)
    {
        Action a;
        if (const char *err = parse_action(item, a, strict)) return err;
        r.actions.push_back(std::move(a));
    }
    return nullptr;
}

// ---------------------------------------------------------------------------------------------
// Persistence: one document per rule
// ---------------------------------------------------------------------------------------------

static void key_of(uint16_t id, char *key) { snprintf(key, 8, "r%u", id); }

static bool save(const Rule &r)
{
    cJSON *json = rule_json(r);
    char *text = cJSON_PrintUnformatted(json), key[8];
    cJSON_Delete(json);
    if (!text) return false;
    key_of(r.id, key);
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err == ESP_OK) {
        err = nvs_set_str(h, key, text);
        if (err == ESP_OK) err = nvs_set_u16(h, "next", s_next_id);
        if (err == ESP_OK) err = nvs_commit(h);
        nvs_close(h);
    }
    cJSON_free(text);
    if (err != ESP_OK) ESP_LOGE(TAG, "Saving rule %u failed: %s", r.id, esp_err_to_name(err));
    return err == ESP_OK;
}

static void erase(uint16_t id)
{
    char key[8];
    key_of(id, key);
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_erase_key(h, key);
    nvs_commit(h);
    nvs_close(h);
}

static bool parse_rule(const char *text, Rule &r)
{
    cJSON *o = cJSON_Parse(text);
    if (!o) return false;
    r = {};
    uint64_t n;
    bool ok = get_uint(o, "id", 0xFFFF, n);
    r.id = n;
    cJSON *owner = cJSON_GetObjectItem(o, "owner");
    r.owner = cJSON_IsNumber(owner) ? owner->valueint : 0;
    r.enabled = !cJSON_IsFalse(cJSON_GetObjectItem(o, "enabled"));
    strlcpy(r.name, cJSON_GetStringValue(cJSON_GetObjectItem(o, "name")) ?: "", sizeof(r.name));
    ok = ok && !parse_trigger(cJSON_GetObjectItem(o, "trigger"), r.trigger, false) &&
         !parse_actions(cJSON_GetObjectItem(o, "actions"), r, false);
    cJSON_Delete(o);
    return ok;
}

static void load()
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) == ESP_OK) {
        nvs_get_u16(h, "next", &s_next_id);
        nvs_iterator_t it = nullptr;
        esp_err_t res = nvs_entry_find(NVS_DEFAULT_PART_NAME, NS, NVS_TYPE_STR, &it);
        while (res == ESP_OK) {
            nvs_entry_info_t info;
            nvs_entry_info(it, &info);
            size_t len = 0;
            if (nvs_get_str(h, info.key, nullptr, &len) == ESP_OK && len) {
                std::vector<char> text(len);
                Rule r;
                if (nvs_get_str(h, info.key, text.data(), &len) == ESP_OK && parse_rule(text.data(), r))
                    s_rules.push_back(r);
                else ESP_LOGW(TAG, "Skipping unreadable rule %s", info.key);
            }
            res = nvs_entry_next(&it);
        }
        nvs_release_iterator(it);
        nvs_close(h);
    }
    for (auto &r : s_rules)
        if (r.id >= s_next_id) s_next_id = r.id + 1;
    std::sort(s_rules.begin(), s_rules.end(), [](const Rule &a, const Rule &b) { return a.id < b.id; });
}

// ---------------------------------------------------------------------------------------------
// Running rules (Matter task, stack lock held)
// ---------------------------------------------------------------------------------------------

static void send(const Action &a, uint32_t cluster, uint32_t command, const char *data = nullptr)
{
    esp_err_t err = controller::send_invoke_cluster_command(a.node, a.ep, cluster, command, data);
    if (err != ESP_OK)
        ESP_LOGW(TAG, "Command 0x%lx/0x%lx to node 0x%llx failed: %s", (unsigned long)cluster,
                 (unsigned long)command, (unsigned long long)a.node, esp_err_to_name(err));
}

/** Steps are 20 % brightness / 40 mireds; moves take about 4 s from end to end. */
static void run_endpoint(const Action &a)
{
    char data[72];
    switch (a.command) {
    case CMD_TOGGLE: send(a, OnOff::Id, OnOff::Commands::Toggle::Id); break;
    case CMD_ON: send(a, OnOff::Id, OnOff::Commands::On::Id); break;
    case CMD_OFF: send(a, OnOff::Id, OnOff::Commands::Off::Id); break;
    case CMD_LEVEL:
        snprintf(data, sizeof(data), "{\"0:U8\":%u,\"1:U16\":5,\"2:U8\":0,\"3:U8\":0}", a.value);
        send(a, LevelControl::Id, LevelControl::Commands::MoveToLevelWithOnOff::Id, data);
        break;
    // StepWithOnOff turns the light on when stepping up; Step down doesn't turn it off.
    case CMD_BRIGHTER:
        send(a, LevelControl::Id, LevelControl::Commands::StepWithOnOff::Id,
             "{\"0:U8\":0,\"1:U8\":51,\"2:U16\":3,\"3:U8\":0,\"4:U8\":0}");
        break;
    case CMD_DARKER:
        send(a, LevelControl::Id, LevelControl::Commands::Step::Id,
             "{\"0:U8\":1,\"1:U8\":51,\"2:U16\":3,\"3:U8\":0,\"4:U8\":0}");
        break;
    // Step mode 1 = up (more mireds = warmer), 3 = down. Min/max 0 = the light's own range.
    case CMD_WARMER:
        send(a, ColorControl::Id, ColorControl::Commands::StepColorTemperature::Id,
             "{\"0:U8\":1,\"1:U16\":40,\"2:U16\":3,\"3:U16\":0,\"4:U16\":0,\"5:U8\":0,\"6:U8\":0}");
        break;
    case CMD_COOLER:
        send(a, ColorControl::Id, ColorControl::Commands::StepColorTemperature::Id,
             "{\"0:U8\":3,\"1:U16\":40,\"2:U16\":3,\"3:U16\":0,\"4:U16\":0,\"5:U8\":0,\"6:U8\":0}");
        break;
    case CMD_DIM_UP:
        send(a, LevelControl::Id, LevelControl::Commands::MoveWithOnOff::Id,
             "{\"0:U8\":0,\"1:U8\":64,\"2:U8\":0,\"3:U8\":0}");
        break;
    case CMD_DIM_DOWN:
        send(a, LevelControl::Id, LevelControl::Commands::Move::Id, "{\"0:U8\":1,\"1:U8\":64,\"2:U8\":0,\"3:U8\":0}");
        break;
    case CMD_WARMER_HOLD:
        send(a, ColorControl::Id, ColorControl::Commands::MoveColorTemperature::Id,
             "{\"0:U8\":1,\"1:U16\":75,\"2:U16\":0,\"3:U16\":0,\"4:U8\":0,\"5:U8\":0}");
        break;
    case CMD_COOLER_HOLD:
        send(a, ColorControl::Id, ColorControl::Commands::MoveColorTemperature::Id,
             "{\"0:U8\":3,\"1:U16\":75,\"2:U16\":0,\"3:U16\":0,\"4:U8\":0,\"5:U8\":0}");
        break;
    default: break;
    }
}

/** Released after a hold: stop the movement run_endpoint() started. */
static void stop_endpoint(const Action &a)
{
    switch (a.command) {
    case CMD_DIM_UP:
        send(a, LevelControl::Id, LevelControl::Commands::StopWithOnOff::Id, "{\"0:U8\":0,\"1:U8\":0}");
        break;
    case CMD_DIM_DOWN: send(a, LevelControl::Id, LevelControl::Commands::Stop::Id, "{\"0:U8\":0,\"1:U8\":0}"); break;
    case CMD_WARMER_HOLD:
    case CMD_COOLER_HOLD:
        send(a, ColorControl::Id, ColorControl::Commands::StopMoveStep::Id, "{\"0:U8\":0,\"1:U8\":0}");
        break;
    default: break;
    }
}

static void run_request(const Action &a)
{
    chip::Optional<uint16_t> timed;
    if (a.timed_ms) timed.SetValue(a.timed_ms);
    const char *data = a.data.empty() ? nullptr : a.data.c_str();
    esp_err_t err = a.type == A_INVOKE
                        ? controller::send_invoke_cluster_command(a.node, a.ep, a.cluster, a.id, data, timed)
                        : controller::send_write_attr_command(a.node, a.ep, a.cluster, a.id, data, timed);
    if (err != ESP_OK)
        ESP_LOGW(TAG, "%s 0x%lx/0x%lx to node 0x%llx failed: %s", a.type == A_INVOKE ? "Command" : "Write",
                 (unsigned long)a.cluster, (unsigned long)a.id, (unsigned long long)a.node, esp_err_to_name(err));
}

/** The actions the owner may still run. */
static void run(const Rule &r, bool release = false)
{
    if (!owner_exists(r.owner)) return;
    for (size_t i = 0; i < r.actions.size(); i++) {
        const Action &a = r.actions[i];
        if (const char *p = action_problem(r.owner, a)) {
            if (!release) ESP_LOGW(TAG, "Rule %u, action %d skipped: %s", r.id, (int)i + 1, p);
            continue;
        }
        if (a.type == A_ENDPOINT) {
            if (!release) run_endpoint(a);
            else if (is_continuous(a.command)) stop_endpoint(a);
        } else if ((a.type == A_INVOKE || a.type == A_WRITE) && !release) {
            run_request(a);
        } else if (a.type == A_SCENE && !release) {
            espm_scene_run(a.scene, r.owner);
        }
    }
}

void espm_automations_button(uint64_t node, uint16_t ep, espm_button_t button, bool release)
{
    for (const Rule &r : s_rules) {
        const Trigger &t = r.trigger;
        if (!r.enabled || t.type != T_BUTTON || t.node != node || t.ep != ep || t.gesture != button) continue;
        if (!espm_auto_allowed(r.owner, node, ep, ESPM_PERM_READ)) continue;
        if (!release) ESP_LOGI(TAG, "Rule %u: node 0x%llx/%u %s", r.id, (unsigned long long)node, ep, name_of(GESTURES, button));
        run(r, release);
    }
}

static int64_t uptime_s() { return esp_timer_get_time() / 1000000; }

/**
 * A value rule's next state. Fires when the value enters the condition (and held it `for_s`); fires
 * again only after it went back past the threshold by the hysteresis. The first value after boot,
 * an edit or a reconnect only sets the state: a rule doesn't fire for what was already true.
 */
static void step_value(Rule &r, float v)
{
    const Trigger &t = r.trigger;
    const bool met = t.cmp == CMP_BELOW ? v < t.threshold : v > t.threshold;
    switch (r.vstate) {
    case V_UNKNOWN: r.vstate = met ? V_DONE : V_ARMED; break;
    case V_ARMED:
        if (!met) break;
        r.vstate = V_PENDING;
        r.vsince = uptime_s();
        [[fallthrough]];
    case V_PENDING:
        if (!met) r.vstate = V_ARMED;
        else if (uptime_s() - r.vsince >= t.for_s) {
            r.vstate = V_DONE;
            ESP_LOGI(TAG, "Rule %u: %s %s %g (%g)", r.id, t.key, t.cmp == CMP_BELOW ? "below" : "above", t.threshold, v);
            run(r);
        }
        break;
    case V_DONE:
        if (t.cmp == CMP_BELOW ? v >= t.threshold + t.hysteresis : v <= t.threshold - t.hysteresis) r.vstate = V_ARMED;
        break;
    }
}

void espm_automations_value(uint64_t node, uint16_t ep, const char *key, float value)
{
    for (Rule &r : s_rules) {
        const Trigger &t = r.trigger;
        if (!r.enabled || t.type != T_VALUE || t.node != node || t.ep != ep || strcmp(t.key, key)) continue;
        if (!espm_auto_allowed(r.owner, node, ep, ESPM_PERM_READ)) continue;
        step_value(r, value);
    }
}

/** Every tick: starts rules from the current value, finishes `for` delays, forgets offline sensors. */
static void check_values()
{
    for (Rule &r : s_rules) {
        const Trigger &t = r.trigger;
        if (!r.enabled || t.type != T_VALUE) continue;
        float v;
        if (!espm_controller_value(t.node, t.ep, t.key, &v) ||
            !espm_auto_allowed(r.owner, t.node, t.ep, ESPM_PERM_READ))
            r.vstate = V_UNKNOWN;
        else if (r.vstate == V_UNKNOWN || r.vstate == V_PENDING)
            step_value(r, v);
    }
}

/** Last minute handled (Unix time / 60), 0: none yet. */
static int64_t s_last_minute;

static void run_minute(int64_t minute)
{
    time_t at = minute * 60;
    struct tm local;
    localtime_r(&at, &local);
    const int of_day = local.tm_hour * 60 + local.tm_min;
    for (Rule &r : s_rules) {
        const Trigger &t = r.trigger;
        if (!r.enabled) continue;
        if (t.type == T_ONCE && t.at / 60 == minute) {
            ESP_LOGI(TAG, "Rule %u: once at %02d:%02d", r.id, local.tm_hour, local.tm_min);
            run(r);
            // Done: kept, switched off – it can be set to a new time.
            r.enabled = false;
            save(r);
            continue;
        }
        if (t.type != T_TIME || t.minute != of_day || !(t.days & (1 << local.tm_wday))) continue;
        ESP_LOGI(TAG, "Rule %u: %02d:%02d", r.id, local.tm_hour, local.tm_min);
        run(r);
    }
}

static void time_tick(chip::System::Layer *, void *)
{
    check_values();
    if (espm_time_valid()) {
        int64_t now = time(nullptr) / 60;
        // After boot or a clock jump: from now on – times missed meanwhile are skipped, not run late.
        if (!s_last_minute || now < s_last_minute || now - s_last_minute > 5) s_last_minute = now - 1;
        while (s_last_minute < now) run_minute(++s_last_minute);
    }
    chip::DeviceLayer::SystemLayer().StartTimer(chip::System::Clock::Seconds32(5), time_tick, nullptr);
}

void espm_automations_node_removed(uint64_t node)
{
    for (size_t i = s_rules.size(); i-- > 0;) {
        Rule &r = s_rules[i];
        bool drop = (r.trigger.type == T_BUTTON || r.trigger.type == T_VALUE) && r.trigger.node == node;
        const size_t before = r.actions.size();
        r.actions.erase(std::remove_if(r.actions.begin(), r.actions.end(),
                                       [node](const Action &a) { return to_endpoint(a) && a.node == node; }),
                        r.actions.end());
        if (r.actions.size() == before && !drop) continue;
        if (drop || r.actions.empty()) {
            erase(r.id);
            s_rules.erase(s_rules.begin() + i);
        } else {
            save(r);
        }
    }
    espm_scenes_node_removed(node);
}

void espm_automations_start()
{
    espm_time_zone(ESPM_CTRL_TZ);
    espm_locked([] {
        load();
        espm_scenes_start();
        chip::DeviceLayer::SystemLayer().StartTimer(chip::System::Clock::Seconds32(5), time_tick, nullptr);
    });
    ESP_LOGI(TAG, "%u automations", (unsigned)s_rules.size());
}

// ---------------------------------------------------------------------------------------------
// REST API (every account: its own rules; admins: all)
// ---------------------------------------------------------------------------------------------

#if ESPM_HTTP
static Rule *find_visible(httpd_req_t *req)
{
    unsigned long id = strtoul(strrchr(req->uri, '/') + 1, nullptr, 10);
    for (auto &r : s_rules)
        if (r.id == id) return espm_caller_admin() || r.owner == espm_auto_caller() ? &r : nullptr;
    return nullptr;
}

static esp_err_t list(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON *clock = cJSON_AddObjectToObject(json, "clock");
    cJSON_AddBoolToObject(clock, "synced", espm_time_valid());
    if (espm_time_valid()) {
        time_t now = time(nullptr);
        struct tm local;
        localtime_r(&now, &local);
        char zone[16];
        strftime(zone, sizeof(zone), "%Z", &local);
        cJSON_AddNumberToObject(clock, "minute", local.tm_hour * 60 + local.tm_min);
        cJSON_AddNumberToObject(clock, "weekday", local.tm_wday);
        cJSON_AddStringToObject(clock, "zone", zone);
        cJSON_AddNumberToObject(clock, "now", (double)now);
    }
    cJSON *rules = cJSON_AddArrayToObject(json, "rules");
    const int me = espm_auto_caller();
    const bool admin = espm_caller_admin();
    espm_locked([&] {
        for (const Rule &r : s_rules) {
            if (!admin && r.owner != me) continue;
            cJSON *o = rule_json(r);
            cJSON_DeleteItemFromObject(o, "owner");
#if ESPM_USERS
            cJSON_AddStringToObject(o, "owner", r.owner ? espm_users_name(r.owner) : "admin");
#else
            cJSON_AddStringToObject(o, "owner", "admin");
#endif
            cJSON_AddBoolToObject(o, "mine", r.owner == me);
            const char *p = problem(r);
            cJSON_AddBoolToObject(o, "active", r.enabled && !p);
            if (p) cJSON_AddStringToObject(o, "problem", p);
            cJSON_AddItemToArray(rules, o);
        }
    });
    cJSON_AddNumberToObject(json, "max", MAX_RULES);
    return espm_send_json(req, json);
}

/** Read the fields of a request into `r` (missing ones stay); 400 text or null. */
static const char *apply(cJSON *body, Rule &r, bool create)
{
    cJSON *name = cJSON_GetObjectItem(body, "name"), *enabled = cJSON_GetObjectItem(body, "enabled");
    cJSON *trigger = cJSON_GetObjectItem(body, "trigger"), *actions = cJSON_GetObjectItem(body, "actions");
    if (name) {
        if (!cJSON_IsString(name) || strlen(name->valuestring) >= NAME_LEN) return "name: up to 31 characters";
        strlcpy(r.name, name->valuestring, sizeof(r.name));
    }
    if (enabled) {
        if (!cJSON_IsBool(enabled)) return "enabled: true or false";
        r.enabled = cJSON_IsTrue(enabled);
    }
    if (trigger || create)
        if (const char *err = parse_trigger(trigger, r.trigger, true)) return err;
    if (actions || create)
        if (const char *err = parse_actions(actions, r, true)) return err;
    for (const Action &a : r.actions)
        if (is_continuous(a.command) && a.type == A_ENDPOINT &&
            !(r.trigger.type == T_BUTTON && r.trigger.gesture == ESPM_BUTTON_HOLD))
            return "this command only works while a button is held";
    if (actions || create) {
        cJSON *json = rule_json(r);
        char *text = cJSON_PrintUnformatted(json);
        cJSON_Delete(json);
        const size_t len = text ? strlen(text) : 0;
        cJSON_free(text);
        if (len >= MAX_STORED) return "too much to store: use fewer actions or a scene";
    }
    return nullptr;
}

/** 403 text if the caller may not use what the rule refers to. */
static const char *forbidden(const Rule &r, int user)
{
    const Trigger &t = r.trigger;
    if (t.type == T_BUTTON && !espm_auto_allowed(user, t.node, t.ep, ESPM_PERM_READ)) return "no access to this button";
    if (t.type == T_VALUE && !espm_auto_allowed(user, t.node, t.ep, ESPM_PERM_READ)) return "no access to this sensor";
    for (const Action &a : r.actions) {
        if (to_endpoint(a) && !espm_auto_allowed(user, a.node, a.ep, ESPM_PERM_WRITE))
            return "no write access to this device";
        if (a.type == A_SCENE && !espm_scene_usable(user, a.scene)) return "no such scene";
    }
    return nullptr;
}

static esp_err_t send_id(httpd_req_t *req, int id)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", true);
    cJSON_AddNumberToObject(json, "id", id);
    return espm_send_json(req, json);
}

static esp_err_t add(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    Rule r = {};
    r.enabled = true;
    r.owner = espm_auto_caller();
    const char *err = apply(body, r, true);
    cJSON_Delete(body);
    if (err) return espm_send_error(req, 400, err);
    int status = 0;
    espm_locked([&] {
        if ((err = forbidden(r, r.owner))) status = 403;
        else if (s_rules.size() >= MAX_RULES) {
            status = 409;
            err = "too many automations";
        } else {
            r.id = s_next_id++;
            if (!s_next_id) s_next_id = 1;
            if (save(r)) s_rules.push_back(r);
            else {
                status = 500;
                err = "saving failed";
            }
        }
    });
    return err ? espm_send_error(req, status, err) : send_id(req, r.id);
}

static esp_err_t change(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    const char *err = nullptr;
    int status = 400;
    espm_locked([&] {
        Rule *r = find_visible(req);
        if (!r) {
            status = 404;
            err = "no such automation";
            return;
        }
        Rule changed = *r;
        if ((err = apply(body, changed, false))) return;
        changed.vstate = V_UNKNOWN;
        // What's new needs the caller's access (a rule only toggled keeps its old references).
        if (cJSON_GetObjectItem(body, "trigger") || cJSON_GetObjectItem(body, "actions"))
            if ((err = forbidden(changed, espm_auto_caller()))) {
                status = 403;
                return;
            }
        if (!save(changed)) {
            status = 500;
            err = "saving failed";
            return;
        }
        *r = changed;
    });
    cJSON_Delete(body);
    return err ? espm_send_error(req, status, err) : espm_send_ok(req);
}

static esp_err_t remove(httpd_req_t *req)
{
    bool found = espm_locked([&] {
        Rule *r = find_visible(req);
        if (!r) return false;
        erase(r->id);
        s_rules.erase(s_rules.begin() + (r - s_rules.data()));
        return true;
    });
    return found ? espm_send_ok(req) : espm_send_error(req, 404, "no such automation");
}

struct AutomationRoutes {
    AutomationRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/controller/automations", list, ESPM_ACCOUNT);
        espm_route(HTTP_POST, "/api/v1/controller/automations", add, ESPM_ACCOUNT);
        espm_route(HTTP_PUT, "/api/v1/controller/automations/*", change, ESPM_ACCOUNT);
        espm_route(HTTP_DELETE, "/api/v1/controller/automations/*", remove, ESPM_ACCOUNT);
    }
};
static AutomationRoutes s_routes;
#endif
