// espmatter studio – update relay: Thread devices pull their updates from the app through the hub.
//   GET  /api/v1/relay/devices/<id>/update  → app /api/v1/devices/<id>/update (image URL rewritten)
//   GET  /api/v1/relay/devices/<id>/config.bin → app /api/v1/devices/<id>/config.bin, streamed
//   POST /api/v1/relay/devices/<id>/report  → app /api/v1/devices/<id>/report
//   GET  /api/v1/relay/images/<path>        → app /api/v1/firmware/<path>, streamed
// The caller's Authorization header is forwarded unchanged: the app decides, the hub only relays.
#include "espm.h"
#include "espm_relay.h"

#include <string.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <mdns.h>

static const char *TAG = "espm_relay";
static unsigned s_requests, s_transfers;
static unsigned long long s_bytes;
static char s_last_device[40], s_last_error[64];

#if ESPM_HTTP
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

/** `/api/v1/relay/devices/<id>/<rest>` → `/devices/<id>/<rest>` (+ query). */
static const char *app_path(httpd_req_t *req) { return req->uri + strlen("/api/v1/relay"); }

static esp_err_t fail(httpd_req_t *req, esp_http_client_handle_t client, const char *msg)
{
    strlcpy(s_last_error, msg, sizeof(s_last_error));
    esp_http_client_cleanup(client);
    return espm_send_error(req, 502, msg);
}

/** Stream a binary from the app (firmware image, device configuration). */
static esp_err_t stream(httpd_req_t *req, const char *path)
{
    esp_http_client_handle_t client = upstream(req, path, HTTP_METHOD_GET);
    if (esp_http_client_open(client, 0) != ESP_OK) return fail(req, client, "app unreachable");
    int64_t length = esp_http_client_fetch_headers(client);
    if (esp_http_client_get_status_code(client) != 200) return fail(req, client, "not available");
    s_transfers++;
    httpd_resp_set_type(req, "application/octet-stream");
    if (length > 0) {
        char len[16];
        snprintf(len, sizeof(len), "%lld", (long long)length);
        httpd_resp_set_hdr(req, "Content-Length", len);
    }
    static char buf[2048];
    int n;
    while ((n = esp_http_client_read(client, buf, sizeof(buf))) > 0) {
        if (httpd_resp_send_chunk(req, buf, n) != ESP_OK) break;
        s_bytes += n;
    }
    esp_http_client_cleanup(client);
    return httpd_resp_send_chunk(req, nullptr, 0);
}

static esp_err_t manifest(httpd_req_t *req)
{
    s_requests++;
    const char *path = app_path(req);
    sscanf(path, "/devices/%39[^/]", s_last_device);
    if (strstr(path, "/config.bin")) return stream(req, path);
    esp_http_client_handle_t client = upstream(req, path, HTTP_METHOD_GET);
    if (esp_http_client_open(client, 0) != ESP_OK) return fail(req, client, "app unreachable");
    esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    if (status == 204) {
        esp_http_client_cleanup(client);
        httpd_resp_set_status(req, "204 No Content");
        return httpd_resp_send(req, nullptr, 0);
    }
    char buf[512] = {};
    int n = esp_http_client_read_response(client, buf, sizeof(buf) - 1);
    esp_http_client_cleanup(client);
    cJSON *json = n > 0 ? cJSON_Parse(buf) : nullptr;
    if (status != 200 || !json) {
        cJSON_Delete(json);
        return espm_send_error(req, status ? status : 502, "no update");
    }
    // http://app/api/v1/firmware/<build>/<slot>.bin → http://[hub]/api/v1/relay/images/<build>/<slot>.bin
    // (a manifest with only a new configuration has no image URL)
    cJSON *url = cJSON_GetObjectItem(json, "url");
    if (cJSON_IsString(url)) {
        const char *tail = strstr(url->valuestring, "/api/v1/firmware/");
        char host[64] = {}, rewritten[256];
        httpd_req_get_hdr_value_str(req, "Host", host, sizeof(host));
        snprintf(rewritten, sizeof(rewritten), "http://%s/api/v1/relay/images/%s", host, tail ? tail + 17 : "");
        cJSON_SetValuestring(url, rewritten);
    }
    return espm_send_json(req, json);
}

static esp_err_t image(httpd_req_t *req)
{
    char path[200];
    snprintf(path, sizeof(path), "/firmware/%s", req->uri + strlen("/api/v1/relay/images/"));
    return stream(req, path);
}

static esp_err_t report(httpd_req_t *req)
{
    char body[512];
    int len = httpd_req_recv(req, body, sizeof(body) - 1);
    if (len <= 0) return espm_send_error(req, 400, "empty report");
    esp_http_client_handle_t client = upstream(req, app_path(req), HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, len);
    esp_err_t err = esp_http_client_perform(client);
    esp_http_client_cleanup(client);
    return err == ESP_OK ? espm_send_ok(req) : espm_send_error(req, 502, "app unreachable");
}

static esp_err_t stats(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "requests", s_requests);
    cJSON_AddNumberToObject(json, "transfers", s_transfers);
    cJSON_AddNumberToObject(json, "bytes", (double)s_bytes);
    cJSON_AddStringToObject(json, "lastDevice", s_last_device);
    cJSON_AddStringToObject(json, "lastError", s_last_error);
    return espm_send_json(req, json);
}

struct RelayRoutes {
    RelayRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/relay", stats);
        espm_route(HTTP_GET, "/api/v1/relay/devices/*", manifest, ESPM_PUBLIC);
        espm_route(HTTP_POST, "/api/v1/relay/devices/*", report, ESPM_PUBLIC);
        espm_route(HTTP_GET, "/api/v1/relay/images/*", image, ESPM_PUBLIC);
    }
};
static RelayRoutes s_routes;
#endif

void espm_relay_start()
{
    // Announced on the LAN; the border router's discovery proxy makes it visible to Thread devices.
    mdns_init();
    mdns_service_add("espm-relay", "_espm-relay", "_tcp", 80, nullptr, 0);
    ESP_LOGI(TAG, "Update relay announced");
}
