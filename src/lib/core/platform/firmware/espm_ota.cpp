// espmatter studio – firmware updates: pulled from the app (or a hub's relay), rollback guard.
// The device asks every ESPM_UPDATE_INTERVAL_MIN minutes, or at once when the app calls
// POST /api/v1/ota/check. The device configuration comes the same way: the manifest names the
// current revision and the device fetches `config.bin`. Compiled in when the network allows it;
// each device switches it on or off in its configuration (ESPM_UPDATE_PULL_ON).
#include "espm.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_https_ota.h>
#include <esp_log.h>
#include <esp_ota_ops.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

static const char *TAG = "espm_ota";

static const char *s_state = "idle";
static int64_t s_last_check; // uptime (s) of the last update check, 0: none yet
static char s_error[96];
static TaskHandle_t s_pull_task;

#if ESPM_UPDATE_PULL
static void set_error(const char *msg)
{
    strlcpy(s_error, msg, sizeof(s_error));
    s_state = "failed";
    ESP_LOGE(TAG, "%s", msg);
}

static void restart_later(void *)
{
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
}

static inline void restart_soon() { xTaskCreate(restart_later, "restart", 2048, nullptr, 5, nullptr); }

static char s_bearer[80];
/** Where manifests and reports go: the app, or (Thread devices) the relay of a hub. */
static char s_base[160];

#if ESPM_UPDATE_VIA_HUB
#include <esp_openthread.h>
#include <esp_openthread_lock.h>
#include <openthread/dns_client.h>
#include <freertos/semphr.h>

static SemaphoreHandle_t s_found;

static void on_resolved(otError err, const otDnsServiceResponse *resp, void *)
{
    otDnsServiceInfo info = {};
    char host[64];
    info.mHostNameBuffer = host;
    info.mHostNameBufferSize = sizeof(host);
    if (err == OT_ERROR_NONE && otDnsServiceResponseGetServiceInfo(resp, &info) == OT_ERROR_NONE) {
        char addr[OT_IP6_ADDRESS_STRING_SIZE];
        otIp6AddressToString(&info.mHostAddress, addr, sizeof(addr));
        snprintf(s_base, sizeof(s_base), "http://[%s]:%u/api/v1/relay", addr, info.mPort);
    }
    xSemaphoreGive(s_found);
}

/** Find a hub's update relay with DNS-SD (the border router proxies the hub's mDNS service). */
static bool discover_relay()
{
    if (!s_found) s_found = xSemaphoreCreateBinary();
    s_base[0] = 0;
    esp_openthread_lock_acquire(portMAX_DELAY);
    otError err = otDnsClientResolveService(esp_openthread_get_instance(), "espm-relay",
                                            "_espm-relay._tcp.default.service.arpa.", on_resolved, nullptr, nullptr);
    esp_openthread_lock_release();
    if (err != OT_ERROR_NONE) return false;
    xSemaphoreTake(s_found, pdMS_TO_TICKS(15000));
    if (s_base[0]) ESP_LOGI(TAG, "Update relay at %s", s_base);
    return s_base[0] != 0;
}
#endif

/** https:// URLs (the app on the internet) are verified against the built-in CA bundle. */
static void tls(esp_http_client_config_t &cfg)
{
    if (strncmp(cfg.url, "https://", 8) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
}

static esp_err_t add_auth(esp_http_client_handle_t client)
{
    return esp_http_client_set_header(client, "Authorization", s_bearer);
}

/** Where updates come from: the app, or a hub's relay once found. */
static bool have_base()
{
#if ESPM_UPDATE_VIA_HUB
    if (!s_base[0]) discover_relay();
#endif
    return s_base[0] != 0;
}

/**
 * Tell the app what runs on a slot and how an update went. The main board's report also carries
 * its configuration revision.
 */
void espm_update_report(const char *slot, const char *state, int version, int running, const char *message)
{
    char url[256], body[320];
    if (!s_base[0]) return;
    snprintf(url, sizeof(url), "%s/devices/%s/report", s_base, ESPM_DEVICE_ID);
    if (strcmp(slot, ESPM_SLOT) == 0)
        snprintf(body, sizeof(body),
                 "{\"slot\":\"%s\",\"state\":\"%s\",\"version\":%d,\"running\":%d,\"config\":\"%s\",\"message\":\"%s\"}",
                 slot, state, version, running, ESPM_CFG_REV, message ? message : "");
    else
        snprintf(body, sizeof(body), "{\"slot\":\"%s\",\"state\":\"%s\",\"version\":%d,\"running\":%d,\"message\":\"%s\"}",
                 slot, state, version, running, message ? message : "");
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.method = HTTP_METHOD_POST;
    cfg.timeout_ms = 10000;
    tls(cfg);
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Authorization", s_bearer);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));
    esp_http_client_perform(client);
    esp_http_client_cleanup(client);
}

static void report(const char *state, int version, const char *message)
{
    espm_update_report(ESPM_SLOT, state, version, ESPM_FW_VERSION, message);
}

/** The update the app has for another slot of this device (one the main board flashes over a wire). */
bool espm_update_manifest(const char *slot, int running, espm_update_t *out)
{
    if (!have_base()) return false;
    char url[256];
    snprintf(url, sizeof(url), "%s/devices/%s/update?slot=%s&version=%d", s_base, ESPM_DEVICE_ID, slot, running);
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.timeout_ms = 10000;
    tls(cfg);
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Authorization", s_bearer);
    bool found = false;
    if (esp_http_client_open(client, 0) == ESP_OK) {
        esp_http_client_fetch_headers(client);
        if (esp_http_client_get_status_code(client) == 200) {
            char buf[512] = {};
            int n = esp_http_client_read_response(client, buf, sizeof(buf) - 1);
            cJSON *json = n > 0 ? cJSON_Parse(buf) : nullptr;
            cJSON *v = cJSON_GetObjectItem(json, "version");
            cJSON *u = cJSON_GetObjectItem(json, "url");
            cJSON *size = cJSON_GetObjectItem(json, "size");
            cJSON *sha = cJSON_GetObjectItem(json, "sha256");
            if (cJSON_IsNumber(v) && cJSON_IsString(u) && (int)v->valuedouble != running) {
                *out = {};
                out->version = (int)v->valuedouble;
                strlcpy(out->url, u->valuestring, sizeof(out->url));
                out->size = cJSON_IsNumber(size) ? (int)size->valuedouble : 0;
                if (cJSON_IsString(sha)) strlcpy(out->sha256, sha->valuestring, sizeof(out->sha256));
                found = true;
            }
            cJSON_Delete(json);
        }
    }
    esp_http_client_cleanup(client);
    return found;
}

/** Start downloading an image with the device's token: the client, past the headers, or nullptr. */
esp_http_client_handle_t espm_update_open(const char *url, int64_t *length)
{
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.timeout_ms = 20000;
    cfg.buffer_size = 2048;
    tls(cfg);
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Authorization", s_bearer);
    if (esp_http_client_open(client, 0) == ESP_OK) {
        *length = esp_http_client_fetch_headers(client);
        if (esp_http_client_get_status_code(client) == 200) return client;
    }
    esp_http_client_cleanup(client);
    return nullptr;
}

/**
 * 204: nothing to do; 200: `{"version": n, "url": "…"}` for a new firmware and/or
 * `{"config": "<rev>"}` when the app has another configuration for this device.
 */
static bool fetch_manifest(int *version, char *image_url, size_t len, bool *config)
{
    char url[256];
    *config = false;
    snprintf(url, sizeof(url), "%s/devices/%s/update?slot=%s&version=%d&config=%s", s_base, ESPM_DEVICE_ID,
             ESPM_SLOT, ESPM_FW_VERSION, ESPM_CFG_REV);
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.timeout_ms = 10000;
    tls(cfg);
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Authorization", s_bearer);
    bool found = false;
    if (esp_http_client_open(client, 0) == ESP_OK) {
        esp_http_client_fetch_headers(client);
        if (esp_http_client_get_status_code(client) == 200) {
            char buf[512] = {};
            int n = esp_http_client_read_response(client, buf, sizeof(buf) - 1);
            cJSON *json = n > 0 ? cJSON_Parse(buf) : nullptr;
            cJSON *v = cJSON_GetObjectItem(json, "version");
            cJSON *u = cJSON_GetObjectItem(json, "url");
            cJSON *c = cJSON_GetObjectItem(json, "config");
            if (cJSON_IsNumber(v) && cJSON_IsString(u)) {
                *version = (int)v->valuedouble;
                strlcpy(image_url, u->valuestring, len);
                found = *version != ESPM_FW_VERSION;
            }
            if (cJSON_IsString(c) && strcmp(c->valuestring, ESPM_CFG_REV) != 0) {
                *config = true;
                found = true;
            }
            cJSON_Delete(json);
        }
    }
    esp_http_client_cleanup(client);
    return found;
}

/** Download this device's configuration (`config.bin`) and install it. */
static bool pull_config()
{
    size_t size = espm_cfg_size();
    if (!size) return false;
    char url[256];
    snprintf(url, sizeof(url), "%s/devices/%s/config.bin", s_base, ESPM_DEVICE_ID);
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.timeout_ms = 10000;
    tls(cfg);
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Authorization", s_bearer);
    uint8_t *image = (uint8_t *)malloc(size);
    esp_err_t err = ESP_FAIL;
    if (image && esp_http_client_open(client, 0) == ESP_OK) {
        int64_t length = esp_http_client_fetch_headers(client);
        if (esp_http_client_get_status_code(client) == 200 && length == (int64_t)size) {
            int total = 0, n;
            while (total < (int)size && (n = esp_http_client_read(client, (char *)image + total, size - total)) > 0)
                total += n;
            err = total == (int)size ? espm_cfg_write(image, size) : ESP_ERR_INVALID_SIZE;
        }
    }
    esp_http_client_cleanup(client);
    free(image);
    if (err != ESP_OK) {
        set_error("configuration download failed");
        report("failed", ESPM_FW_VERSION, s_error);
        return false;
    }
    ESP_LOGI(TAG, "New configuration installed – restarting");
    restart_soon();
    return true;
}

static void pull_once()
{
    s_last_check = esp_timer_get_time() / 1000000;
#if ESPM_UPDATE_VIA_HUB
    if (!s_base[0] && !discover_relay()) return;
#endif
    int version = 0;
    char image[256] = {};
    bool config = false;
    if (!fetch_manifest(&version, image, sizeof(image), &config)) {
#if ESPM_SLOTFLASH
        // Boards flashed over a wire: an update for one of them means a restart (the wires are in use).
        espm_slotflash_check();
#endif
        return;
    }
    // The configuration first: the device restarts with it and asks again for the firmware.
    if (config) {
        pull_config();
        return;
    }
    if (version == ESPM_FW_VERSION || !image[0]) return;
    ESP_LOGI(TAG, "Update to version %d: %s", version, image);
    s_state = "downloading";
    report("downloading", version, nullptr);

    esp_http_client_config_t http = {};
    http.url = image;
    http.timeout_ms = 20000;
    tls(http);
    http.keep_alive_enable = true;
    esp_https_ota_config_t ota = {};
    ota.http_config = &http;
    ota.http_client_init_cb = add_auth;
    esp_err_t err = esp_https_ota(&ota);
    if (err == ESP_OK) {
        s_state = "installed";
        report("installed", version, nullptr);
        restart_soon();
    } else {
        set_error(esp_err_to_name(err));
        report("failed", version, s_error);
    }
}

static void pull_task(void *)
{
    // Wait for the network, then report what's running (the app learns version and settings).
    while (!espm_online()) vTaskDelay(pdMS_TO_TICKS(2000));
#if ESPM_UPDATE_VIA_HUB
    vTaskDelay(pdMS_TO_TICKS(10000)); // let SRP/DNS settle after joining the Thread network
    discover_relay();
#endif
    report("running", ESPM_FW_VERSION, nullptr);
    // With pull updates off, the device only reports (the app learns its version and settings).
    if (!ESPM_UPDATE_PULL_ON) {
        s_pull_task = nullptr;
        vTaskDelete(nullptr);
    }
    for (;;) {
        pull_once();
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(ESPM_UPDATE_INTERVAL_MIN * 60 * 1000));
    }
}
#endif

bool espm_ota_check_now()
{
    if (!s_pull_task) return false;
    xTaskNotifyGive(s_pull_task);
    return true;
}

#if ESPM_HTTP
static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "version", ESPM_FW_VERSION);
    cJSON_AddStringToObject(json, "config", ESPM_CFG_REV);
    cJSON_AddBoolToObject(json, "pull", ESPM_UPDATE_PULL && ESPM_UPDATE_PULL_ON);
    const esp_partition_t *running = esp_ota_get_running_partition();
    cJSON_AddStringToObject(json, "partition", running ? running->label : "");
    cJSON_AddStringToObject(json, "state", s_state);
    // The check is stamped with the uptime (the clock may not be set yet at boot): report how long
    // ago, and the time of day only once the clock is set (NTP) – never a date in 1970.
    if (s_last_check) {
        int64_t ago = esp_timer_get_time() / 1000000 - s_last_check;
        cJSON_AddNumberToObject(json, "lastCheckAgo", (double)ago);
        time_t t = time(nullptr);
        if (t > 1700000000) cJSON_AddNumberToObject(json, "lastCheck", (double)(t - ago));
    }
    cJSON_AddStringToObject(json, "lastError", s_error);
    return espm_send_json(req, json);
}

#if ESPM_UPDATE_PULL
/** POST /api/v1/ota/check: the app has something new – ask for it now instead of at the next check. */
static esp_err_t check(httpd_req_t *req)
{
    if (!espm_ota_check_now()) return espm_send_error(req, 409, "updates from the app are off for this device");
    return espm_send_ok(req);
}
#endif
#endif

void espm_ota_init()
{
    // A new image that got this far works: keep it (otherwise the bootloader rolls back).
    esp_ota_mark_app_valid_cancel_rollback();
#if ESPM_HTTP
    espm_route(HTTP_GET, "/api/v1/ota", status);
#if ESPM_UPDATE_PULL
    espm_route(HTTP_POST, "/api/v1/ota/check", check);
#endif
#endif
#if ESPM_UPDATE_PULL
    snprintf(s_bearer, sizeof(s_bearer), "Bearer %s", ESPM_API_TOKEN);
#if !ESPM_UPDATE_VIA_HUB
    snprintf(s_base, sizeof(s_base), "%s/api/v1", ESPM_APP_URL);
#endif
    if (ESPM_APP_URL[0] || ESPM_UPDATE_VIA_HUB) xTaskCreate(pull_task, "espm_pull", 6144, nullptr, 3, &s_pull_task);
#endif
}
