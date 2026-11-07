// espmatter studio – accounts of the web interface (hubs). Besides the built-in admin (password
// from the app, in espm_cfg), admins create accounts on the device itself: admins, or users with
// read/write grants on resources (`n<node>`, `n<node>.<endpoint>`). Stored as JSON in the default
// NVS partition, so configuration updates from the app leave them alone. Passwords: PBKDF2-SHA256.
// New accounts and password resets get a random password (shown once to the admin) that the user
// must change at the next login; until then the session may only do that (espm_http.cpp).
// Read from other tasks too (automations check their owner's grants): s_mutex guards the accounts.
#include "espm.h"

#if ESPM_HTTP && ESPM_USERS
#include <algorithm>
#include <mutex>
#include <optional>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <esp_log.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <nvs.h>
#include <mbedtls/md.h>
#include <mbedtls/pkcs5.h>

static const char *TAG = "espm_users";
static const char *NS = "espm_users";

static constexpr int MAX_ACCOUNTS = 16;
static constexpr int MAX_GRANTS = 96;
static constexpr int ITERATIONS = 2000;
static constexpr int NAME_LEN = 24;
static constexpr int RES_LEN = 16;

struct Grant {
    char res[RES_LEN];
    espm_perm_t level;
};

struct Account {
    int id;
    char name[NAME_LEN];
    bool admin;
    /** Has a generated password: must change it before doing anything else. */
    bool must_change;
    uint8_t salt[16];
    uint8_t hash[32];
    std::vector<Grant> grants;
};

static std::vector<Account> *s_accounts;
static int s_next_id = 1;
static std::recursive_mutex s_mutex;
using Guard = std::lock_guard<std::recursive_mutex>;

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

static void hex(const uint8_t *in, size_t n, char *out)
{
    for (size_t i = 0; i < n; i++) sprintf(out + 2 * i, "%02x", in[i]);
}

static bool unhex(const char *in, uint8_t *out, size_t n)
{
    if (!in || strlen(in) != 2 * n) return false;
    for (size_t i = 0; i < n; i++) {
        unsigned v;
        if (sscanf(in + 2 * i, "%2x", &v) != 1) return false;
        out[i] = (uint8_t)v;
    }
    return true;
}

static bool valid_resource(const char *res)
{
    size_t n = strlen(res);
    if (!n || n >= RES_LEN) return false;
    for (const char *p = res; *p; p++)
        if (!isalnum((unsigned char)*p) && *p != '.' && *p != '_' && *p != '-') return false;
    return true;
}

static void load()
{
    if (s_accounts) return;
    s_accounts = new std::vector<Account>();
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return;
    size_t len = 0;
    std::string text;
    if (nvs_get_blob(h, "accounts", nullptr, &len) == ESP_OK && len) {
        text.resize(len);
        nvs_get_blob(h, "accounts", text.data(), &len);
    }
    nvs_close(h);
    cJSON *json = cJSON_ParseWithLength(text.data(), text.size());
    if (!json) return;
    cJSON *next = cJSON_GetObjectItem(json, "next");
    if (cJSON_IsNumber(next)) s_next_id = next->valueint;
    cJSON *item;
    cJSON_ArrayForEach(item, cJSON_GetObjectItem(json, "accounts"))
    {
        Account a = {};
        cJSON *id = cJSON_GetObjectItem(item, "id"), *name = cJSON_GetObjectItem(item, "name");
        if (!cJSON_IsNumber(id) || !cJSON_IsString(name)) continue;
        a.id = id->valueint;
        strlcpy(a.name, name->valuestring, sizeof(a.name));
        a.admin = cJSON_IsTrue(cJSON_GetObjectItem(item, "admin"));
        a.must_change = cJSON_IsTrue(cJSON_GetObjectItem(item, "change"));
        if (!unhex(cJSON_GetStringValue(cJSON_GetObjectItem(item, "salt")), a.salt, sizeof(a.salt)) ||
            !unhex(cJSON_GetStringValue(cJSON_GetObjectItem(item, "hash")), a.hash, sizeof(a.hash)))
            continue;
        cJSON *g;
        cJSON_ArrayForEach(g, cJSON_GetObjectItem(item, "grants"))
        {
            if (!cJSON_IsNumber(g) || !valid_resource(g->string) || (int)a.grants.size() >= MAX_GRANTS) continue;
            Grant grant = {};
            strlcpy(grant.res, g->string, sizeof(grant.res));
            grant.level = (espm_perm_t)std::min(std::max(g->valueint, 0), 2);
            a.grants.push_back(grant);
        }
        s_accounts->push_back(std::move(a));
        if (s_next_id <= s_accounts->back().id) s_next_id = s_accounts->back().id + 1;
    }
    cJSON_Delete(json);
    ESP_LOGI(TAG, "%d accounts", (int)s_accounts->size());
}

static cJSON *grants_json(const Account &a)
{
    cJSON *g = cJSON_CreateObject();
    for (auto &grant : a.grants) cJSON_AddNumberToObject(g, grant.res, grant.level);
    return g;
}

static bool save()
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "next", s_next_id);
    cJSON *list = cJSON_AddArrayToObject(json, "accounts");
    for (auto &a : *s_accounts) {
        char salt[33], hash[65];
        hex(a.salt, sizeof(a.salt), salt);
        hex(a.hash, sizeof(a.hash), hash);
        cJSON *o = cJSON_CreateObject();
        cJSON_AddNumberToObject(o, "id", a.id);
        cJSON_AddStringToObject(o, "name", a.name);
        cJSON_AddBoolToObject(o, "admin", a.admin);
        if (a.must_change) cJSON_AddBoolToObject(o, "change", true);
        cJSON_AddStringToObject(o, "salt", salt);
        cJSON_AddStringToObject(o, "hash", hash);
        cJSON_AddItemToObject(o, "grants", grants_json(a));
        cJSON_AddItemToArray(list, o);
    }
    char *text = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!text) return false;
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err == ESP_OK) {
        err = nvs_set_blob(h, "accounts", text, strlen(text));
        if (err == ESP_OK) err = nvs_commit(h);
        nvs_close(h);
    }
    cJSON_free(text);
    if (err != ESP_OK) ESP_LOGE(TAG, "Saving accounts failed: %s", esp_err_to_name(err));
    return err == ESP_OK;
}

static Account *find(int id)
{
    load();
    for (auto &a : *s_accounts)
        if (a.id == id) return &a;
    return nullptr;
}

static Account *find(const char *name)
{
    load();
    for (auto &a : *s_accounts)
        if (!strcmp(a.name, name)) return &a;
    return nullptr;
}

// ---------------------------------------------------------------------------------------------
// Passwords and permissions
// ---------------------------------------------------------------------------------------------

static void derive(const char *password, const uint8_t *salt, uint8_t *out)
{
    mbedtls_pkcs5_pbkdf2_hmac_ext(MBEDTLS_MD_SHA256, (const unsigned char *)password, strlen(password), salt, 16,
                                  ITERATIONS, 32, out);
}

static void set_password(Account &a, const char *password)
{
    esp_fill_random(a.salt, sizeof(a.salt));
    derive(password, a.salt, a.hash);
}

/** `password` is the account's. Same work whether or not there is an account. */
static bool check_password(const Account *a, const char *password)
{
    static const uint8_t dummy[16] = {};
    uint8_t hash[32];
    derive(password, a ? a->salt : dummy, hash);
    if (!a) return false;
    uint8_t diff = 0;
    for (int i = 0; i < 32; i++) diff |= hash[i] ^ a->hash[i];
    return !diff;
}

/** A random password for the admin to pass on (no look-alike characters), and the change flag. */
static std::string generate_password(Account &a)
{
    static const char CHARS[] = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    std::string pw(14, ' ');
    for (auto &c : pw) c = CHARS[esp_random() % (sizeof(CHARS) - 1)];
    set_password(a, pw.c_str());
    a.must_change = true;
    return pw;
}

int espm_users_login(const char *name, const char *password)
{
    std::optional<Account> a;
    {
        Guard g(s_mutex);
        if (Account *found = find(name)) a = *found;
    }
    // Hashing takes a while: not with the lock held.
    return check_password(a ? &*a : nullptr, password) ? a->id : -1;
}

bool espm_users_must_change(int user)
{
    Guard g(s_mutex);
    Account *a = find(user);
    return a && a->must_change;
}

int espm_users_role(int user)
{
    Guard g(s_mutex);
    Account *a = find(user);
    return a ? (a->admin ? 1 : 0) : -1;
}

const char *espm_users_name(int user)
{
    Guard g(s_mutex);
    Account *a = find(user);
    return a ? a->name : "";
}

espm_perm_t espm_users_permission(int user, const char *resource)
{
    Guard g(s_mutex);
    Account *a = find(user);
    if (!a) return ESPM_PERM_NONE;
    if (a->admin) return ESPM_PERM_WRITE;
    // The resource's own grant, else its parent's (`n17.2` → `n17`).
    char res[RES_LEN];
    strlcpy(res, resource, sizeof(res));
    for (;;) {
        for (auto &g : a->grants)
            if (!strcmp(g.res, res)) return g.level;
        char *dot = strrchr(res, '.');
        if (!dot) return ESPM_PERM_NONE;
        *dot = 0;
    }
}

/** `res` is `resource` or one of its children. */
static bool within(const char *res, const char *resource, size_t n)
{
    return !strncmp(res, resource, n) && (!res[n] || res[n] == '.');
}

bool espm_users_permission_any(int user, const char *resource)
{
    Guard g(s_mutex);
    if (espm_users_permission(user, resource)) return true;
    Account *a = find(user);
    size_t n = strlen(resource);
    if (a)
        for (auto &g : a->grants)
            if (g.level && within(g.res, resource, n)) return true;
    return false;
}

void espm_users_forget(const char *resource)
{
    Guard g(s_mutex);
    load();
    size_t n = strlen(resource);
    bool changed = false;
    for (auto &a : *s_accounts) {
        auto before = a.grants.size();
        a.grants.erase(std::remove_if(a.grants.begin(), a.grants.end(),
                                      [&](const Grant &g) { return within(g.res, resource, n); }),
                       a.grants.end());
        changed |= a.grants.size() != before;
    }
    if (changed) save();
}

// ---------------------------------------------------------------------------------------------
// REST API (admins only)
// ---------------------------------------------------------------------------------------------

#if ESPM_UI
static bool valid_name(const char *name)
{
    size_t n = strlen(name);
    if (!n || n >= NAME_LEN || !strcmp(name, "admin")) return false;
    for (const char *p = name; *p; p++)
        if (!islower((unsigned char)*p) && !isdigit((unsigned char)*p) && *p != '.' && *p != '_' && *p != '-')
            return false;
    return true;
}

static bool valid_password(cJSON *pw) { return cJSON_IsString(pw) && strlen(pw->valuestring) >= 8 && strlen(pw->valuestring) <= 64; }

static cJSON *account_json(const Account &a)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "id", a.id);
    cJSON_AddStringToObject(o, "name", a.name);
    cJSON_AddBoolToObject(o, "admin", a.admin);
    cJSON_AddBoolToObject(o, "mustChange", a.must_change);
    cJSON_AddItemToObject(o, "grants", grants_json(a));
    return o;
}

/** The account and, once, its new generated password. */
static esp_err_t send_with_password(httpd_req_t *req, const Account &a, const std::string &pw)
{
    cJSON *o = account_json(a);
    cJSON_AddStringToObject(o, "password", pw.c_str());
    return espm_send_json(req, o);
}

/** Replace the grants with `{"<resource>": 0|1|2}`. False: invalid. */
static bool apply_grants(Account &a, cJSON *grants)
{
    if (!cJSON_IsObject(grants) || cJSON_GetArraySize(grants) > MAX_GRANTS) return false;
    std::vector<Grant> list;
    cJSON *g;
    cJSON_ArrayForEach(g, grants)
    {
        if (!cJSON_IsNumber(g) || g->valueint < 0 || g->valueint > 2 || !valid_resource(g->string)) return false;
        Grant grant = {};
        strlcpy(grant.res, g->string, sizeof(grant.res));
        grant.level = (espm_perm_t)g->valueint;
        list.push_back(grant);
    }
    a.grants = std::move(list);
    return true;
}

static esp_err_t list(httpd_req_t *req)
{
    Guard g(s_mutex);
    load();
    cJSON *json = cJSON_CreateObject();
    cJSON *arr = cJSON_AddArrayToObject(json, "accounts");
    cJSON *builtin = cJSON_CreateObject();
    cJSON_AddNumberToObject(builtin, "id", 0);
    cJSON_AddStringToObject(builtin, "name", "admin");
    cJSON_AddBoolToObject(builtin, "admin", true);
    cJSON_AddBoolToObject(builtin, "builtin", true);
    cJSON_AddItemToArray(arr, builtin);
    for (auto &a : *s_accounts) cJSON_AddItemToArray(arr, account_json(a));
    return espm_send_json(req, json);
}

static esp_err_t create(httpd_req_t *req)
{
    Guard g(s_mutex);
    load();
    cJSON *body = espm_read_json(req, 4096);
    if (!body) return ESP_FAIL;
    cJSON *name = cJSON_GetObjectItem(body, "name");
    cJSON *grants = cJSON_GetObjectItem(body, "grants");
    const char *problem = nullptr;
    Account a = {};
    if ((int)s_accounts->size() >= MAX_ACCOUNTS) problem = "account limit reached";
    else if (!cJSON_IsString(name) || !valid_name(name->valuestring))
        problem = "name: 1–23 lowercase letters, digits, . _ - (not \"admin\")";
    else if (find(name->valuestring)) problem = "an account with this name exists";
    else if (grants && !apply_grants(a, grants)) problem = "invalid grants";
    if (problem) {
        cJSON_Delete(body);
        return espm_send_error(req, 400, problem);
    }
    a.id = s_next_id++;
    strlcpy(a.name, name->valuestring, sizeof(a.name));
    a.admin = cJSON_IsTrue(cJSON_GetObjectItem(body, "admin"));
    std::string pw = generate_password(a);
    cJSON_Delete(body);
    s_accounts->push_back(std::move(a));
    if (!save()) return espm_send_error(req, 500, "saving failed");
    return send_with_password(req, s_accounts->back(), pw);
}

static int id_of(httpd_req_t *req) { return atoi(strrchr(req->uri, '/') + 1); }

static esp_err_t update(httpd_req_t *req)
{
    Guard g(s_mutex);
    Account *a = find(id_of(req));
    if (!a) return espm_send_error(req, 404, "no such account");
    cJSON *body = espm_read_json(req, 4096);
    if (!body) return ESP_FAIL;
    cJSON *admin = cJSON_GetObjectItem(body, "admin");
    cJSON *grants = cJSON_GetObjectItem(body, "grants");
    bool reset = cJSON_IsTrue(cJSON_GetObjectItem(body, "resetPassword"));
    Account changed = *a;
    if (grants && !apply_grants(changed, grants)) {
        cJSON_Delete(body);
        return espm_send_error(req, 400, "invalid grants");
    }
    if (cJSON_IsBool(admin)) changed.admin = cJSON_IsTrue(admin);
    std::string pw = reset ? generate_password(changed) : "";
    cJSON_Delete(body);
    *a = std::move(changed);
    if (reset) espm_session_clear(a->id); // a new password logs the account out everywhere
    if (!save()) return espm_send_error(req, 500, "saving failed");
    return reset ? send_with_password(req, *a, pw) : espm_send_json(req, account_json(*a));
}

static esp_err_t drop(httpd_req_t *req)
{
    Guard g(s_mutex);
    load();
    int id = id_of(req);
    auto it = std::find_if(s_accounts->begin(), s_accounts->end(), [&](const Account &a) { return a.id == id; });
    if (it == s_accounts->end()) return espm_send_error(req, 404, "no such account");
    s_accounts->erase(it);
    espm_session_clear(id);
    if (!save()) return espm_send_error(req, 500, "saving failed");
    return espm_send_ok(req);
}

/**
 * POST /api/v1/auth/password {"current", "password"} → {"token"}: change your own password (any
 * account but the built-in admin, whose password is set in the app). Ends all sessions of the
 * account and returns a new one.
 */
static esp_err_t change_password(httpd_req_t *req)
{
    int id = espm_caller_user();
    std::optional<Account> copy;
    {
        Guard g(s_mutex);
        if (Account *found = id > 0 ? find(id) : nullptr) copy = *found;
    }
    if (!copy) return espm_send_error(req, 409, "the admin password is set in the app");
    cJSON *body = espm_read_json(req, 256);
    if (!body) return ESP_FAIL;
    cJSON *current = cJSON_GetObjectItem(body, "current"), *pw = cJSON_GetObjectItem(body, "password");
    const char *problem = nullptr;
    int status = 400;
    if (!cJSON_IsString(current) || !check_password(&*copy, current->valuestring)) {
        problem = "the current password is wrong";
        status = 403;
    } else if (!valid_password(pw)) problem = "password: 8–64 characters";
    else if (!strcmp(pw->valuestring, current->valuestring)) problem = "choose a different password";
    if (problem) {
        cJSON_Delete(body);
        if (status == 403) vTaskDelay(pdMS_TO_TICKS(1000)); // slow down guessing
        return espm_send_error(req, status, problem);
    }
    set_password(*copy, pw->valuestring);
    cJSON_Delete(body);
    {
        Guard g(s_mutex);
        Account *a = find(id);
        if (!a) return espm_send_error(req, 404, "no such account");
        memcpy(a->salt, copy->salt, sizeof(a->salt));
        memcpy(a->hash, copy->hash, sizeof(a->hash));
        a->must_change = false;
        if (!save()) return espm_send_error(req, 500, "saving failed");
    }
    espm_session_clear(id);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "token", espm_session_create(id));
    return espm_send_json(req, json);
}

struct UserRoutes {
    UserRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/auth/accounts", list);
        espm_route(HTTP_POST, "/api/v1/auth/accounts", create);
        espm_route(HTTP_PUT, "/api/v1/auth/accounts/*", update);
        espm_route(HTTP_DELETE, "/api/v1/auth/accounts/*", drop);
        espm_route(HTTP_POST, "/api/v1/auth/password", change_password, ESPM_ACCOUNT);
    }
};
static UserRoutes s_routes;
#endif
#endif
