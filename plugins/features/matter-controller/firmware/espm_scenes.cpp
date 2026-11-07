// espmatter studio – scenes: named states of several endpoints ("Movie night"), set at once from
// the dashboard or by automations. Activating remembers how the endpoints were (in RAM), and
// deactivating puts that back – or turns them off when it isn't known (e.g. after a restart).
//
// Every account makes its own; owner and admins see, run and edit it, others per grant on `s<id>`
// (read: see and run, write: also edit). A scene runs with the access of whoever runs it, skipping
// endpoints they may not control. Each scene is a JSON document
// in NVS (`s<id>`), so new member fields (e.g. setpoints) need no migration. Stack lock held throughout.
#include "espm.h"
#include "espm_automations.h"
#include "espm_controller.h"

#include <math.h>
#include <string.h>
#include <vector>
#include <algorithm>
#include <esp_log.h>
#include <nvs.h>
#include <app-common/zap-generated/cluster-objects.h>
#include <esp_matter_controller_cluster_command.h>

using namespace esp_matter;
using namespace chip::app::Clusters;

static const char *TAG = "espm_scenes";
static const char *NS = "espm_scenes";

static constexpr size_t MAX_SCENES = 16;
static constexpr size_t MAX_MEMBERS = 12;
static constexpr int NAME_LEN = 32;
/** Transitions in 1/10 s: a short fade instead of a hard switch. */
static constexpr int TRANSITION = 5;

struct Member {
    uint64_t node;
    uint16_t ep;
    bool on;
    uint8_t level;   // 1–254, 0: leave it
    uint16_t mireds; // 0: leave it
};

/** How a member was before the scene; 0 / -1: unknown. */
struct Before {
    int8_t on;
    uint8_t level;
    uint16_t mireds;
};

struct Scene {
    uint16_t id;
    int owner;
    char name[NAME_LEN];
    std::vector<Member> members;
    bool active;
    std::vector<Before> before;
};

static std::vector<Scene> s_scenes;
static uint16_t s_next_id = 1;

static Scene *find(uint16_t id)
{
    for (auto &s : s_scenes)
        if (s.id == id) return &s;
    return nullptr;
}

static bool is_admin(int user)
{
#if ESPM_USERS
    return user == 0 || espm_users_role(user) == 1;
#else
    return user == 0;
#endif
}

espm_perm_t espm_scene_access(int user, uint16_t id)
{
    Scene *s = find(id);
    if (!s) return ESPM_PERM_NONE;
    if (s->owner == user || is_admin(user)) return ESPM_PERM_WRITE;
#if ESPM_USERS
    char res[8];
    snprintf(res, sizeof(res), "s%u", id);
    return espm_users_permission(user, res);
#else
    return ESPM_PERM_NONE;
#endif
}

bool espm_scene_usable(int user, uint16_t id) { return espm_scene_access(user, id) >= ESPM_PERM_READ; }

// ---------------------------------------------------------------------------------------------
// JSON and persistence: one document per scene
// ---------------------------------------------------------------------------------------------

static bool get_uint(cJSON *o, const char *key, double max, uint64_t &out)
{
    cJSON *v = cJSON_GetObjectItem(o, key);
    if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > max) return false;
    out = (uint64_t)v->valuedouble;
    return true;
}

static cJSON *scene_json(const Scene &s)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "id", s.id);
    cJSON_AddStringToObject(o, "name", s.name);
    cJSON_AddNumberToObject(o, "owner", s.owner);
    cJSON *list = cJSON_AddArrayToObject(o, "members");
    for (auto &m : s.members) {
        cJSON *mo = cJSON_CreateObject();
        cJSON_AddNumberToObject(mo, "node", (double)m.node);
        cJSON_AddNumberToObject(mo, "endpoint", m.ep);
        cJSON_AddBoolToObject(mo, "on", m.on);
        if (m.level) cJSON_AddNumberToObject(mo, "level", m.level);
        if (m.mireds) cJSON_AddNumberToObject(mo, "colorTemperature", m.mireds);
        cJSON_AddItemToArray(list, mo);
    }
    return o;
}

static const char *parse_members(cJSON *list, std::vector<Member> &out)
{
    if (!cJSON_IsArray(list) || !cJSON_GetArraySize(list)) return "members: at least one";
    if (cJSON_GetArraySize(list) > (int)MAX_MEMBERS) return "members: at most 12";
    out.clear();
    cJSON *item;
    cJSON_ArrayForEach(item, list)
    {
        Member m = {};
        uint64_t n;
        if (!get_uint(item, "node", 1e15, m.node) || !get_uint(item, "endpoint", 0xFFFE, n))
            return "a member needs node and endpoint";
        m.ep = n;
        for (auto &o : out)
            if (o.node == m.node && o.ep == m.ep) return "an endpoint is in the scene twice";
        m.on = !cJSON_IsFalse(cJSON_GetObjectItem(item, "on"));
        if (cJSON_GetObjectItem(item, "level")) {
            if (!get_uint(item, "level", 254, n) || !n) return "level: 1–254";
            m.level = n;
        }
        if (cJSON_GetObjectItem(item, "colorTemperature")) {
            if (!get_uint(item, "colorTemperature", 1000, n) || n < 50) return "colorTemperature: 50–1000 mireds";
            m.mireds = n;
        }
        out.push_back(m);
    }
    return nullptr;
}

static void key_of(uint16_t id, char *key) { snprintf(key, 8, "s%u", id); }

static bool save(const Scene &s)
{
    cJSON *json = scene_json(s);
    char *text = cJSON_PrintUnformatted(json), key[8];
    cJSON_Delete(json);
    if (!text) return false;
    key_of(s.id, key);
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err == ESP_OK) {
        err = nvs_set_str(h, key, text);
        if (err == ESP_OK) err = nvs_set_u16(h, "next", s_next_id);
        if (err == ESP_OK) err = nvs_commit(h);
        nvs_close(h);
    }
    cJSON_free(text);
    if (err != ESP_OK) ESP_LOGE(TAG, "Saving scene %u failed: %s", s.id, esp_err_to_name(err));
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

static bool parse_scene(const char *text, Scene &s)
{
    cJSON *o = cJSON_Parse(text);
    if (!o) return false;
    uint64_t n;
    bool ok = get_uint(o, "id", 0xFFFF, n);
    s.id = n;
    cJSON *owner = cJSON_GetObjectItem(o, "owner");
    s.owner = cJSON_IsNumber(owner) ? owner->valueint : 0;
    strlcpy(s.name, cJSON_GetStringValue(cJSON_GetObjectItem(o, "name")) ?: "", sizeof(s.name));
    // A scene whose devices were all removed has no members – keep it.
    cJSON *members = cJSON_GetObjectItem(o, "members");
    ok = ok && (!cJSON_GetArraySize(members) || !parse_members(members, s.members));
    cJSON_Delete(o);
    return ok;
}

void espm_scenes_start()
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return;
    nvs_get_u16(h, "next", &s_next_id);
    nvs_iterator_t it = nullptr;
    esp_err_t res = nvs_entry_find(NVS_DEFAULT_PART_NAME, NS, NVS_TYPE_STR, &it);
    while (res == ESP_OK) {
        nvs_entry_info_t info;
        nvs_entry_info(it, &info);
        size_t len = 0;
        if (nvs_get_str(h, info.key, nullptr, &len) == ESP_OK && len) {
            std::vector<char> text(len);
            Scene s = {};
            if (nvs_get_str(h, info.key, text.data(), &len) == ESP_OK && parse_scene(text.data(), s))
                s_scenes.push_back(std::move(s));
            else ESP_LOGW(TAG, "Skipping unreadable scene %s", info.key);
        }
        res = nvs_entry_next(&it);
    }
    nvs_release_iterator(it);
    nvs_close(h);
    for (auto &s : s_scenes)
        if (s.id >= s_next_id) s_next_id = s.id + 1;
    std::sort(s_scenes.begin(), s_scenes.end(), [](const Scene &a, const Scene &b) { return a.id < b.id; });
    ESP_LOGI(TAG, "%u scenes", (unsigned)s_scenes.size());
}

void espm_scenes_node_removed(uint64_t node)
{
    for (auto &s : s_scenes) {
        auto before = s.members.size();
        s.members.erase(std::remove_if(s.members.begin(), s.members.end(), [&](const Member &m) { return m.node == node; }),
                        s.members.end());
        if (s.members.size() == before) continue;
        s.active = false;
        s.before.clear();
        save(s);
    }
}

// ---------------------------------------------------------------------------------------------
// Running scenes
// ---------------------------------------------------------------------------------------------

static void send(const Member &m, uint32_t cluster, uint32_t command, const char *data = nullptr)
{
    esp_err_t err = controller::send_invoke_cluster_command(m.node, m.ep, cluster, command, data);
    if (err != ESP_OK)
        ESP_LOGW(TAG, "Command 0x%lx/0x%lx to node 0x%llx/%u failed: %s", (unsigned long)cluster,
                 (unsigned long)command, (unsigned long long)m.node, m.ep, esp_err_to_name(err));
}

/** Bring the endpoint to `on`, `level` and `mireds` (0: leave). */
static void apply(const Member &m, bool on, uint8_t level, uint16_t mireds)
{
    char data[80];
    if (!on) return send(m, OnOff::Id, OnOff::Commands::Off::Id);
    // ExecuteIfOff, so the color is right when the light comes on.
    if (mireds) {
        snprintf(data, sizeof(data), "{\"0:U16\":%u,\"1:U16\":%d,\"2:U8\":1,\"3:U8\":1}", mireds, TRANSITION);
        send(m, ColorControl::Id, ColorControl::Commands::MoveToColorTemperature::Id, data);
    }
    if (level) {
        snprintf(data, sizeof(data), "{\"0:U8\":%u,\"1:U16\":%d,\"2:U8\":0,\"3:U8\":0}", level, TRANSITION);
        send(m, LevelControl::Id, LevelControl::Commands::MoveToLevelWithOnOff::Id, data);
    } else {
        send(m, OnOff::Id, OnOff::Commands::On::Id);
    }
}

static Before current(const Member &m)
{
    Before b = {-1, 0, 0};
    float v;
    if (espm_controller_value(m.node, m.ep, "on", &v)) b.on = v != 0;
    if (espm_controller_value(m.node, m.ep, "level", &v) && v >= 1) b.level = (uint8_t)lroundf(v);
    if (espm_controller_value(m.node, m.ep, "colorTemperature", &v) && v >= 1) b.mireds = (uint16_t)lroundf(v);
    return b;
}

int espm_scene_run(uint16_t id, bool activate, int user)
{
    Scene *s = find(id);
    if (!s || !espm_scene_usable(user, id)) return -1;
    // Activating an active scene again keeps what was before it.
    const bool remember = activate && !s->active;
    if (remember) s->before.assign(s->members.size(), Before{-1, 0, 0});
    int skipped = 0;
    for (size_t i = 0; i < s->members.size(); i++) {
        const Member &m = s->members[i];
        if (!espm_auto_allowed(user, m.node, m.ep, ESPM_PERM_WRITE)) {
            skipped++;
            continue;
        }
        if (activate) {
            if (remember) s->before[i] = current(m);
            apply(m, m.on, m.level, m.mireds);
        } else {
            const Before b = s->active && i < s->before.size() ? s->before[i] : Before{-1, 0, 0};
            // Only what the scene changed; unknown: off.
            apply(m, b.on == 1, m.level ? b.level : 0, m.mireds ? b.mireds : 0);
        }
    }
    s->active = activate;
    if (!activate) s->before.clear();
    ESP_LOGI(TAG, "Scene %u %s (%d endpoints skipped)", id, activate ? "activated" : "deactivated", skipped);
    return skipped;
}

// ---------------------------------------------------------------------------------------------
// REST API (every account: its own scenes and those granted to it; admins: all)
// ---------------------------------------------------------------------------------------------

#if ESPM_HTTP
/** The scene of `/api/v1/controller/scenes/<id>[/…]` if the caller may do `need` with it. */
static Scene *find_visible(httpd_req_t *req, espm_perm_t need)
{
    const char *p = req->uri + strlen("/api/v1/controller/scenes/");
    Scene *s = find((uint16_t)strtoul(p, nullptr, 10));
    return s && espm_scene_access(espm_auto_caller(), s->id) >= need ? s : nullptr;
}

static esp_err_t list(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON *scenes = cJSON_AddArrayToObject(json, "scenes");
    const int me = espm_auto_caller();
    espm_locked([&] {
        for (const Scene &s : s_scenes) {
            const espm_perm_t access = espm_scene_access(me, s.id);
            if (!access) continue;
            cJSON *o = scene_json(s);
            cJSON_DeleteItemFromObject(o, "owner");
#if ESPM_USERS
            cJSON_AddStringToObject(o, "owner", s.owner ? espm_users_name(s.owner) : "admin");
#else
            cJSON_AddStringToObject(o, "owner", "admin");
#endif
            cJSON_AddBoolToObject(o, "mine", s.owner == me);
            cJSON_AddStringToObject(o, "access", access == ESPM_PERM_WRITE ? "write" : "read");
            cJSON_AddBoolToObject(o, "active", s.active);
            cJSON_AddItemToArray(scenes, o);
        }
    });
    cJSON_AddNumberToObject(json, "max", MAX_SCENES);
    return espm_send_json(req, json);
}

/** Name and members from a request (missing ones stay); 400 text or null. */
static const char *apply_body(cJSON *body, Scene &s, bool create)
{
    cJSON *name = cJSON_GetObjectItem(body, "name"), *members = cJSON_GetObjectItem(body, "members");
    if (name || create) {
        if (!cJSON_IsString(name) || !name->valuestring[0] || strlen(name->valuestring) >= NAME_LEN)
            return "name: 1–31 characters";
        strlcpy(s.name, name->valuestring, sizeof(s.name));
    }
    if (members || create)
        if (const char *err = parse_members(members, s.members)) return err;
    return nullptr;
}

static const char *forbidden(const Scene &s, int user)
{
    for (auto &m : s.members) {
        if (!espm_auto_allowed(user, m.node, m.ep, ESPM_PERM_WRITE)) return "no write access to a device of the scene";
        if (!espm_controller_has_endpoint(m.node, m.ep)) return "no such device";
    }
    return nullptr;
}

static esp_err_t add(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    Scene s = {};
    s.owner = espm_auto_caller();
    const char *err = apply_body(body, s, true);
    cJSON_Delete(body);
    if (err) return espm_send_error(req, 400, err);
    int status = 0;
    espm_locked([&] {
        if ((err = forbidden(s, s.owner))) status = 403;
        else if (s_scenes.size() >= MAX_SCENES) {
            status = 409;
            err = "too many scenes";
        } else {
            s.id = s_next_id++;
            if (!s_next_id) s_next_id = 1;
            if (save(s)) s_scenes.push_back(s);
            else {
                status = 500;
                err = "saving failed";
            }
        }
    });
    if (err) return espm_send_error(req, status, err);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", true);
    cJSON_AddNumberToObject(json, "id", s.id);
    return espm_send_json(req, json);
}

static esp_err_t change(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    const char *err = nullptr;
    int status = 400;
    espm_locked([&] {
        Scene *s = find_visible(req, ESPM_PERM_WRITE);
        if (!s) {
            status = 404;
            err = "no such scene";
            return;
        }
        Scene changed = *s;
        if ((err = apply_body(body, changed, false))) return;
        if (cJSON_GetObjectItem(body, "members")) {
            if ((err = forbidden(changed, espm_auto_caller()))) {
                status = 403;
                return;
            }
            changed.active = false; // what was before no longer matches the members
            changed.before.clear();
        }
        if (!save(changed)) {
            status = 500;
            err = "saving failed";
            return;
        }
        *s = std::move(changed);
    });
    cJSON_Delete(body);
    return err ? espm_send_error(req, status, err) : espm_send_ok(req);
}

/** POST /api/v1/controller/scenes/<id>/activate or …/deactivate */
static esp_err_t run(httpd_req_t *req)
{
    const char *verb = strrchr(req->uri, '/') + 1;
    bool activate = !strcmp(verb, "activate");
    if (!activate && strcmp(verb, "deactivate")) return espm_send_error(req, 404, "activate or deactivate");
    const int me = espm_auto_caller();
    int skipped = espm_locked([&] {
        Scene *s = find_visible(req, ESPM_PERM_READ);
        return s ? espm_scene_run(s->id, activate, me) : -1;
    });
    if (skipped < 0) return espm_send_error(req, 404, "no such scene");
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", true);
    cJSON_AddNumberToObject(json, "skipped", skipped);
    return espm_send_json(req, json);
}

static esp_err_t remove(httpd_req_t *req)
{
    int id = espm_locked([&] {
        Scene *s = find_visible(req, ESPM_PERM_WRITE);
        if (!s) return -1;
        const int removed = s->id;
        erase(s->id);
        s_scenes.erase(s_scenes.begin() + (s - s_scenes.data()));
        return removed;
    });
    if (id < 0) return espm_send_error(req, 404, "no such scene");
    char res[8];
    snprintf(res, sizeof(res), "s%d", id);
    espm_permissions_forget(res); // ids are reused after wrapping
    return espm_send_ok(req);
}

struct SceneRoutes {
    SceneRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/controller/scenes", list, ESPM_ACCOUNT);
        espm_route(HTTP_POST, "/api/v1/controller/scenes", add, ESPM_ACCOUNT);
        espm_route(HTTP_POST, "/api/v1/controller/scenes/*", run, ESPM_ACCOUNT);
        espm_route(HTTP_PUT, "/api/v1/controller/scenes/*", change, ESPM_ACCOUNT);
        espm_route(HTTP_DELETE, "/api/v1/controller/scenes/*", remove, ESPM_ACCOUNT);
    }
};
static SceneRoutes s_routes;
#endif
