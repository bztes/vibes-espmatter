// espmatter studio – HTTP server, REST router, token auth. See espm.h.
#include "espm.h"

#if ESPM_HTTP
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <esp_log.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <mbedtls/md.h>
#include <mbedtls/pkcs5.h>
#include <nvs.h>

static const char *TAG = "espm_http";

struct Route {
    httpd_method_t method;
    const char *uri;
    espm_handler_t handler;
    espm_access_t access;
    void *ctx;
};

static std::vector<Route> *s_routes;
static httpd_handle_t s_server;

struct Session {
    char token[33];
    int user;
};
static constexpr int MAX_SESSIONS = 16;
static Session s_sessions[MAX_SESSIONS];
static int s_next_session;

/** The caller of the request being handled (the server runs one request at a time, in its task). */
struct Caller {
    bool known;
    bool admin;
    int user; // -1: the API token
};
static Caller s_caller;

/** Same time whatever the input (no timing hints about secrets). */
static bool secret_eq(const char *a, const char *b)
{
    size_t la = strlen(a), lb = strlen(b);
    unsigned char diff = la != lb;
    for (size_t i = 0; i < la; i++) diff |= (unsigned char)a[i] ^ (unsigned char)b[i % (lb ? lb : 1)];
    return diff == 0;
}

static bool parse_hex(const char *in, uint8_t *out, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        unsigned v;
        if (!isxdigit((unsigned char)in[2 * i]) || !isxdigit((unsigned char)in[2 * i + 1]) ||
            sscanf(in + 2 * i, "%2x", &v) != 1)
            return false;
        out[i] = (uint8_t)v;
    }
    return true;
}

bool espm_password_check(const char *stored, const char *password)
{
    static const char PREFIX[] = "pbkdf2-sha256$";
    if (!stored || !password || strncmp(stored, PREFIX, sizeof(PREFIX) - 1)) return false;
    char *end;
    long iterations = strtol(stored + sizeof(PREFIX) - 1, &end, 10);
    uint8_t salt[16], expected[32], hash[32];
    // Bounded: a login must not keep the server busy for long.
    if (iterations < 1 || iterations > 100000 || *end != '$' || strlen(end + 1) != 32 + 1 + 64 ||
        !parse_hex(end + 1, salt, 16) || end[33] != '$' || !parse_hex(end + 34, expected, 32))
        return false;
    if (mbedtls_pkcs5_pbkdf2_hmac_ext(MBEDTLS_MD_SHA256, (const unsigned char *)password, strlen(password), salt,
                                      sizeof(salt), (unsigned)iterations, sizeof(hash), hash))
        return false;
    uint8_t diff = 0;
    for (size_t i = 0; i < sizeof(hash); i++) diff |= hash[i] ^ expected[i];
    return !diff;
}

// Sessions are kept in the default NVS partition too, so a reboot doesn't log everybody out (a
// session table of fixed layout; written on login, logout and password changes only).
static const char *SESSION_NS = "espm_http";
static bool s_sessions_loaded;

static void load_sessions()
{
    if (s_sessions_loaded) return;
    s_sessions_loaded = true;
    nvs_handle_t h;
    if (nvs_open(SESSION_NS, NVS_READONLY, &h) != ESP_OK) return;
    Session stored[MAX_SESSIONS];
    size_t len = sizeof(stored);
    int32_t next = 0;
    if (nvs_get_blob(h, "sessions", stored, &len) == ESP_OK && len == sizeof(stored) &&
        nvs_get_i32(h, "next", &next) == ESP_OK && next >= 0 && next < MAX_SESSIONS) {
        for (auto &s : stored) s.token[sizeof(s.token) - 1] = 0;
        memcpy(s_sessions, stored, sizeof(stored));
        s_next_session = next;
    }
    nvs_close(h);
}

static void save_sessions()
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(SESSION_NS, NVS_READWRITE, &h);
    if (err == ESP_OK) {
        err = nvs_set_blob(h, "sessions", s_sessions, sizeof(s_sessions));
        if (err == ESP_OK) err = nvs_set_i32(h, "next", s_next_session);
        if (err == ESP_OK) err = nvs_commit(h);
        nvs_close(h);
    }
    if (err != ESP_OK) ESP_LOGW(TAG, "Saving sessions failed: %s", esp_err_to_name(err));
}

const char *espm_session_create(int user)
{
    load_sessions();
    Session &s = s_sessions[s_next_session];
    s_next_session = (s_next_session + 1) % MAX_SESSIONS;
    for (int i = 0; i < 32; i += 8) snprintf(s.token + i, 9, "%08lx", (unsigned long)esp_random());
    s.user = user;
    save_sessions();
    return s.token;
}

void espm_session_clear(int user)
{
    load_sessions();
    bool changed = false;
    for (auto &s : s_sessions)
        if (s.token[0] && (user < 0 || s.user == user)) {
            s = {};
            changed = true;
        }
    if (changed) save_sessions();
}

/** 1 admin, 0 account, -1 gone. */
static int role_of(int user)
{
    if (user == 0) return 1;
#if ESPM_USERS
    return espm_users_role(user);
#else
    return -1;
#endif
}

static Caller identify(httpd_req_t *req)
{
    char header[96] = {};
    if (httpd_req_get_hdr_value_str(req, "Authorization", header, sizeof(header)) != ESP_OK ||
        strncmp(header, "Bearer ", 7) != 0 || !header[7])
        return {};
    const char *token = header + 7;
    if (ESPM_API_TOKEN[0] && secret_eq(token, ESPM_API_TOKEN)) return {true, true, -1};
    load_sessions();
    for (auto &s : s_sessions) {
        if (!s.token[0] || !secret_eq(token, s.token)) continue;
        int role = role_of(s.user);
        if (role < 0) return {};
        return {true, role == 1, s.user};
    }
    return {};
}

bool espm_caller_admin() { return s_caller.known && s_caller.admin; }

int espm_caller_user() { return s_caller.known ? s_caller.user : -1; }

/** The caller has a generated password to change: then only these routes. */
static bool must_change_password()
{
#if ESPM_USERS
    return s_caller.known && s_caller.user > 0 && espm_users_must_change(s_caller.user);
#else
    return false;
#endif
}
static const char *const WHILE_CHANGING[] = {"/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/password"};

espm_perm_t espm_permission(const char *resource)
{
    if (!s_caller.known) return ESPM_PERM_NONE;
    if (s_caller.admin) return ESPM_PERM_WRITE;
#if ESPM_USERS
    return espm_users_permission(s_caller.user, resource);
#else
    return ESPM_PERM_NONE;
#endif
}

bool espm_permission_any(const char *resource)
{
    if (!s_caller.known) return false;
    if (s_caller.admin) return true;
#if ESPM_USERS
    return espm_users_permission_any(s_caller.user, resource);
#else
    return false;
#endif
}

void espm_permissions_forget(const char *resource)
{
#if ESPM_USERS
    espm_users_forget(resource);
#endif
}

static void cors(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Authorization, Content-Type");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
}

static esp_err_t dispatch(httpd_req_t *req)
{
    auto *route = static_cast<Route *>(req->user_ctx);
    cors(req);
    s_caller = identify(req);
    if (route->access != ESPM_PUBLIC && !s_caller.known) return espm_send_error(req, 401, "unauthorized");
    if (route->access == ESPM_ADMIN && !s_caller.admin) return espm_send_error(req, 403, "admins only");
    if (route->access != ESPM_PUBLIC && must_change_password()) {
        bool allowed = false;
        for (auto *uri : WHILE_CHANGING) allowed |= !strcmp(route->uri, uri);
        if (!allowed) return espm_send_error(req, 403, "change your password first");
    }
    esp_err_t err = route->handler(req);
    s_caller = {};
    return err;
}

static esp_err_t options(httpd_req_t *req)
{
    cors(req);
    httpd_resp_set_status(req, "204 No Content");
    return httpd_resp_send(req, nullptr, 0);
}

void *espm_route_ctx(httpd_req_t *req) { return static_cast<Route *>(req->user_ctx)->ctx; }

void espm_http_init()
{
    if (!s_routes) s_routes = new std::vector<Route>();
}

void espm_route(httpd_method_t method, const char *uri, espm_handler_t handler, espm_access_t access, void *ctx)
{
    espm_http_init();
    s_routes->push_back({method, uri, handler, access, ctx});
}

struct Page {
    const uint8_t *start, *end;
};

static esp_err_t page_handler(httpd_req_t *req)
{
    auto *page = static_cast<Page *>(req->user_ctx);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    return httpd_resp_send(req, (const char *)page->start, page->end - page->start);
}

static std::vector<std::pair<const char *, Page *>> s_pages;

void espm_http_page(const char *uri, const uint8_t *start, const uint8_t *end)
{
    s_pages.push_back({uri, new Page{start, end}});
}

#if ESPM_UI
extern const uint8_t ui_start[] asm("_binary_ui_html_gz_start");
extern const uint8_t ui_end[] asm("_binary_ui_html_gz_end");

static void add_identity(cJSON *json, int user)
{
#if ESPM_USERS
    cJSON_AddStringToObject(json, "user", user > 0 ? espm_users_name(user) : "admin");
#else
    cJSON_AddStringToObject(json, "user", "admin");
#endif
    cJSON_AddBoolToObject(json, "admin", role_of(user) == 1);
#if ESPM_USERS
    if (user > 0 && espm_users_must_change(user)) cJSON_AddBoolToObject(json, "mustChange", true);
#endif
}

/**
 * POST /api/v1/auth/login {"user", "password"} → {"token", "user", "admin", "mustChange"?}: a
 * session for the web interface. `user` "admin" (or none) is the built-in admin with the password
 * set in the app. `mustChange`: a generated password – the session may only change it.
 */
static esp_err_t login(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req, 256);
    if (!body) return ESP_FAIL;
    cJSON *name = cJSON_GetObjectItem(body, "user");
    cJSON *pw = cJSON_GetObjectItem(body, "password");
    int user = -1;
    if (cJSON_IsString(pw)) {
        bool builtin = !cJSON_IsString(name) || !name->valuestring[0] || !strcmp(name->valuestring, "admin");
        // No configuration, no password: the built-in admin can't log in.
        if (builtin) user = espm_password_check(ESPM_UI_PW_HASH, pw->valuestring) ? 0 : -1;
#if ESPM_USERS
        else user = espm_users_login(name->valuestring, pw->valuestring);
#endif
    }
    cJSON_Delete(body);
    if (user < 0) {
        vTaskDelay(pdMS_TO_TICKS(1000)); // slow down guessing
        return espm_send_error(req, 401, "wrong user or password");
    }
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "token", espm_session_create(user));
    add_identity(json, user);
    return espm_send_json(req, json);
}

/** Who is logged in. With the API token: the built-in admin. */
static esp_err_t me(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", true);
    add_identity(json, s_caller.user < 0 ? 0 : s_caller.user);
    return espm_send_json(req, json);
}

static esp_err_t logout(httpd_req_t *req)
{
    char header[96] = {};
    bool changed = false;
    if (httpd_req_get_hdr_value_str(req, "Authorization", header, sizeof(header)) == ESP_OK)
        for (auto &s : s_sessions)
            if (s.token[0] && secret_eq(header + 7, s.token)) {
                s = {};
                changed = true;
            }
    if (changed) save_sessions();
    return espm_send_ok(req);
}
#endif

void espm_http_start()
{
#if ESPM_UI
    espm_http_page("/", ui_start, ui_end);
    espm_route(HTTP_POST, "/api/v1/auth/login", login, ESPM_PUBLIC);
    espm_route(HTTP_GET, "/api/v1/auth/me", me, ESPM_ACCOUNT);
    espm_route(HTTP_POST, "/api/v1/auth/logout", logout, ESPM_ACCOUNT);
#endif
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.max_uri_handlers = s_routes->size() + s_pages.size() + 2;
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.stack_size = 8192;
    config.lru_purge_enable = true;
    if (httpd_start(&s_server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "HTTP server failed to start");
        return;
    }
    for (auto &route : *s_routes) {
        httpd_uri_t uri = {};
        uri.uri = route.uri;
        uri.method = route.method;
        uri.handler = dispatch;
        uri.user_ctx = &route;
        httpd_register_uri_handler(s_server, &uri);
    }
    for (auto &[path, page] : s_pages) {
        httpd_uri_t uri = {};
        uri.uri = path;
        uri.method = HTTP_GET;
        uri.handler = page_handler;
        uri.user_ctx = page;
        httpd_register_uri_handler(s_server, &uri);
    }
    httpd_uri_t opt = {};
    opt.uri = "/*";
    opt.method = HTTP_OPTIONS;
    opt.handler = options;
    httpd_register_uri_handler(s_server, &opt);
    ESP_LOGI(TAG, "REST API on port 80 (%d routes)", (int)s_routes->size());
}

esp_err_t espm_send_json(httpd_req_t *req, cJSON *json, int status)
{
    char *text = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    char line[32];
    snprintf(line, sizeof(line), "%d %s", status, status == 200 ? "OK" : "Error");
    httpd_resp_set_status(req, line);
    httpd_resp_set_type(req, "application/json");
    esp_err_t err = httpd_resp_send(req, text ? text : "{}", HTTPD_RESP_USE_STRLEN);
    cJSON_free(text);
    return err;
}

esp_err_t espm_send_error(httpd_req_t *req, int status, const char *message)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "error", message);
    return espm_send_json(req, json, status);
}

esp_err_t espm_send_ok(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", true);
    return espm_send_json(req, json);
}

cJSON *espm_read_json(httpd_req_t *req, size_t max_len)
{
    if (req->content_len == 0) return cJSON_CreateObject();
    if (req->content_len > max_len) {
        espm_send_error(req, 413, "body too large");
        return nullptr;
    }
    char *buf = (char *)malloc(req->content_len + 1);
    size_t got = 0;
    while (got < req->content_len) {
        int n = httpd_req_recv(req, buf + got, req->content_len - got);
        if (n <= 0) {
            free(buf);
            espm_send_error(req, 400, "body incomplete");
            return nullptr;
        }
        got += n;
    }
    buf[got] = 0;
    cJSON *json = cJSON_Parse(buf);
    free(buf);
    if (!json) espm_send_error(req, 400, "invalid JSON");
    return json;
}
#endif
