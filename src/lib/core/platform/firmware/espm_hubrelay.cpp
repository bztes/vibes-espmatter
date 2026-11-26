// espmatter studio – hub relay: devices that can't (or shouldn't) talk to the app themselves report
// through the hub, and the app reaches them through the hub's tunnel. (Their updates come from the
// hub's Matter OTA provider.)
//   POST /api/v1/relay/devices/<id>/report  → app /api/v1/devices/<id>/report
//   *    /api/v1/relay/forward/<id>/<path>  → the device at its address, /<path>
// The caller's Authorization header is forwarded unchanged: the app decides, the hub only relays.
// A device's address is learned from its relayed requests the app accepted (so only with its token).
#include "espm.h"
#include "espm_hubrelay.h"

#include <stdlib.h>
#include <string.h>
#include <initializer_list>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <lwip/sockets.h>
#include <mdns.h>
#include <nvs.h>

static const char *TAG = "espm_hubrelay";
static unsigned s_requests, s_forwards;
static char s_last_device[40], s_last_error[64];

#if ESPM_HTTP
/** `/api/v1/relay/devices/<id>/<rest>` → `/devices/<id>/<rest>` (+ query). */
static const char *app_path(httpd_req_t *req) { return req->uri + strlen("/api/v1/relay"); }

// --- Addresses of devices (kept in NVS, so a restart of the hub doesn't forget them) ---

static constexpr int MAX_NODES = 32;
struct Node {
    char id[40];
    char addr[48];
    uint32_t seen; // order of learning: the oldest is replaced first
};
static Node s_nodes[MAX_NODES];
static uint32_t s_seen;
static bool s_nodes_loaded;
static const char *NODES_NS = "espm_hubrelay";

static void load_nodes()
{
    if (s_nodes_loaded) return;
    s_nodes_loaded = true;
    nvs_handle_t h;
    if (nvs_open(NODES_NS, NVS_READONLY, &h) != ESP_OK) return;
    size_t len = sizeof(s_nodes);
    if (nvs_get_blob(h, "nodes", s_nodes, &len) != ESP_OK || len != sizeof(s_nodes)) memset(s_nodes, 0, sizeof(s_nodes));
    nvs_close(h);
    for (auto &n : s_nodes) {
        n.id[sizeof(n.id) - 1] = n.addr[sizeof(n.addr) - 1] = 0;
        if (n.seen > s_seen) s_seen = n.seen;
    }
}

static const Node *find_node(const char *id)
{
    load_nodes();
    for (auto &n : s_nodes)
        if (n.id[0] && !strcmp(n.id, id)) return &n;
    return nullptr;
}

/** The device `<id>` of a relayed path called from the caller's address. */
static void learn(httpd_req_t *req)
{
    char id[40] = {};
    if (sscanf(app_path(req), "/devices/%39[^/?]", id) != 1) return;
    sockaddr_in6 peer = {};
    socklen_t len = sizeof(peer);
    if (getpeername(httpd_req_to_sockfd(req), (sockaddr *)&peer, &len) != 0 || peer.sin6_family != AF_INET6)
        return;
    // Wi-Fi devices come as IPv4 (mapped), Thread devices as IPv6. Not the tunnel's loopback, not
    // link-local IPv6 (needs a zone).
    const uint8_t *a = peer.sin6_addr.s6_addr;
    static const uint8_t MAPPED[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff};
    char addr[48];
    if (!memcmp(a, MAPPED, sizeof(MAPPED))) {
        if (a[12] == 127) return;
        snprintf(addr, sizeof(addr), "%u.%u.%u.%u", a[12], a[13], a[14], a[15]);
    } else {
        static const uint8_t LOOPBACK[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
        if ((a[0] == 0xfe && (a[1] & 0xc0) == 0x80) || !memcmp(a, LOOPBACK, 16)) return;
        char ip6[INET6_ADDRSTRLEN];
        if (!inet_ntop(AF_INET6, &peer.sin6_addr, ip6, sizeof(ip6))) return;
        snprintf(addr, sizeof(addr), "[%s]", ip6);
    }
    load_nodes();
    Node *slot = nullptr;
    for (auto &n : s_nodes)
        if (!strcmp(n.id, id)) slot = &n;
    if (slot && !strcmp(slot->addr, addr)) return;
    if (!slot) {
        slot = &s_nodes[0];
        for (auto &n : s_nodes)
            if (!n.id[0] || n.seen < slot->seen) slot = &n;
    }
    strlcpy(slot->id, id, sizeof(slot->id));
    strlcpy(slot->addr, addr, sizeof(slot->addr));
    slot->seen = ++s_seen;
    ESP_LOGI(TAG, "Device %s at %s", id, addr);
    nvs_handle_t h;
    if (nvs_open(NODES_NS, NVS_READWRITE, &h) != ESP_OK) return;
    if (nvs_set_blob(h, "nodes", s_nodes, sizeof(s_nodes)) == ESP_OK) nvs_commit(h);
    nvs_close(h);
}

static esp_http_client_handle_t upstream(httpd_req_t *req, const char *path, esp_http_client_method_t method)
{
    char url[256], auth[96] = {};
    snprintf(url, sizeof(url), "%s/api/v1%s", ESPM_APP_URL, path);
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.method = method;
    cfg.timeout_ms = 20000;
    cfg.buffer_size = 2048;
    if (strncmp(url, "https://", 8) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (httpd_req_get_hdr_value_str(req, "Authorization", auth, sizeof(auth)) == ESP_OK)
        esp_http_client_set_header(client, "Authorization", auth);
    return client;
}

static esp_err_t report(httpd_req_t *req)
{
    s_requests++;
    sscanf(app_path(req), "/devices/%39[^/]", s_last_device);
    char body[512];
    int len = httpd_req_recv(req, body, sizeof(body) - 1);
    if (len <= 0) return espm_send_error(req, 400, "empty report");
    esp_http_client_handle_t client = upstream(req, app_path(req), HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, len);
    esp_err_t err = esp_http_client_perform(client);
    int status = err == ESP_OK ? esp_http_client_get_status_code(client) : 0;
    esp_http_client_cleanup(client);
    if (status >= 200 && status < 300) learn(req);
    if (err != ESP_OK) strlcpy(s_last_error, "app unreachable", sizeof(s_last_error));
    return err == ESP_OK ? espm_send_ok(req) : espm_send_error(req, 502, "app unreachable");
}

// --- Requests of the app for a device ---

/** Answer headers passed back (as the tunnel does); kept until the answer is sent. */
static const char *const PASS_BACK[] = {"Content-Type", "Content-Encoding", "Cache-Control", "Location",
                                        "WWW-Authenticate"};
static char s_pass[sizeof(PASS_BACK) / sizeof(PASS_BACK[0])][128];

static esp_err_t on_forward_event(esp_http_client_event_t *evt)
{
    if (evt->event_id != HTTP_EVENT_ON_HEADER) return ESP_OK;
    for (size_t i = 0; i < sizeof(PASS_BACK) / sizeof(PASS_BACK[0]); i++)
        if (!strcasecmp(evt->header_key, PASS_BACK[i])) strlcpy(s_pass[i], evt->header_value, sizeof(s_pass[i]));
    return ESP_OK;
}

static esp_err_t forward(httpd_req_t *req)
{
    // /api/v1/relay/forward/<id>/<path>
    const char *rest = req->uri + strlen("/api/v1/relay/forward/");
    const char *slash = strchr(rest, '/');
    char id[40] = {};
    if (!slash || slash - rest >= (int)sizeof(id)) return espm_send_error(req, 400, "no device");
    memcpy(id, rest, slash - rest);
    const Node *node = find_node(id);
    // 421: the app tries another way (this hub doesn't know the device).
    if (!node) return espm_send_error(req, 421, "device unknown to this hub");
    s_forwards++;

    char url[600];
    if (snprintf(url, sizeof(url), "http://%s%s", node->addr, slash) >= (int)sizeof(url))
        return espm_send_error(req, 414, "path too long");
    static constexpr size_t MAX_BODY = 16 * 1024; // as the tunnel's
    if (req->content_len > MAX_BODY) return espm_send_error(req, 413, "body too large");
    char *body = nullptr;
    if (req->content_len) {
        body = (char *)malloc(req->content_len);
        if (!body) return espm_send_error(req, 500, "out of memory");
        for (size_t got = 0; got < req->content_len;) {
            int n = httpd_req_recv(req, body + got, req->content_len - got);
            if (n <= 0) {
                free(body);
                return espm_send_error(req, 400, "body incomplete");
            }
            got += n;
        }
    }

    memset(s_pass, 0, sizeof(s_pass));
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.method = req->method == HTTP_POST     ? HTTP_METHOD_POST
                 : req->method == HTTP_PUT    ? HTTP_METHOD_PUT
                 : req->method == HTTP_DELETE ? HTTP_METHOD_DELETE
                                              : HTTP_METHOD_GET;
    cfg.timeout_ms = 15000;
    cfg.buffer_size = 2048;
    cfg.disable_auto_redirect = true;
    cfg.event_handler = on_forward_event;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        free(body);
        return espm_send_error(req, 500, "out of memory");
    }
    char value[128];
    for (const char *name : {"Authorization", "Content-Type", "Accept"})
        if (httpd_req_get_hdr_value_str(req, name, value, sizeof(value)) == ESP_OK)
            esp_http_client_set_header(client, name, value);
    esp_err_t err = esp_http_client_open(client, req->content_len);
    if (err == ESP_OK && body && esp_http_client_write(client, body, req->content_len) != (int)req->content_len)
        err = ESP_FAIL;
    free(body);
    if (err == ESP_OK && esp_http_client_fetch_headers(client) < 0 && !esp_http_client_is_chunked_response(client))
        err = ESP_FAIL;
    if (err != ESP_OK) {
        esp_http_client_cleanup(client);
        strlcpy(s_last_error, "device unreachable", sizeof(s_last_error));
        return espm_send_error(req, 504, "the device didn't answer");
    }
    s_requests++;

    int status = esp_http_client_get_status_code(client);
    static char line[32];
    snprintf(line, sizeof(line), "%d %s", status, status < 400 ? "OK" : "Error");
    httpd_resp_set_status(req, line);
    for (size_t i = 0; i < sizeof(PASS_BACK) / sizeof(PASS_BACK[0]); i++)
        if (s_pass[i][0]) httpd_resp_set_hdr(req, PASS_BACK[i], s_pass[i]);
    if (status == 204 || status == 304) {
        esp_http_client_cleanup(client);
        return httpd_resp_send(req, nullptr, 0);
    }
    static char buf[2048];
    int n;
    while ((n = esp_http_client_read(client, buf, sizeof(buf))) > 0)
        if (httpd_resp_send_chunk(req, buf, n) != ESP_OK) break;
    esp_http_client_cleanup(client);
    return httpd_resp_send_chunk(req, nullptr, 0);
}

static esp_err_t stats(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "requests", s_requests);
    cJSON_AddNumberToObject(json, "forwards", s_forwards);
    cJSON_AddStringToObject(json, "lastDevice", s_last_device);
    cJSON_AddStringToObject(json, "lastError", s_last_error);
    return espm_send_json(req, json);
}

struct RelayRoutes {
    RelayRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/relay", stats);
        espm_route(HTTP_POST, "/api/v1/relay/devices/*", report, ESPM_PUBLIC);
        // Public like the rest: the device checks its own token.
        for (httpd_method_t m : {HTTP_GET, HTTP_POST, HTTP_PUT, HTTP_DELETE})
            espm_route(m, "/api/v1/relay/forward/*", forward, ESPM_PUBLIC);
    }
};
static RelayRoutes s_routes;
#endif

void espm_hubrelay_start()
{
    // Announced on the LAN (Wi-Fi devices); a border router's discovery proxy makes it visible on Thread.
    mdns_init();
    mdns_service_add("espm-relay", "_espm-relay", "_tcp", 80, nullptr, 0);
    ESP_LOGI(TAG, "Relay announced");
}
