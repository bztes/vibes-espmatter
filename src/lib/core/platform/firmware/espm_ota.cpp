// espmatter studio – firmware updates and the rollback guard.
// A Matter device gets its updates over Matter (OTA Requestor): from its hub, the OTA provider of
// the hub's fabric. A hub pulls its own from the app every ESPM_UPDATE_INTERVAL_MIN minutes, or at
// once when the app calls POST /api/v1/ota/check (its own switch: ESPM_UPDATE_PULL_ON). Both tell
// the app what they run, a device through its hub's relay when it has no link of its own.
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
#include <freertos/queue.h>
#include <freertos/task.h>
#if ESPM_MATTER_OTA
#include <app/clusters/ota-requestor/OTARequestorInterface.h>
#include <platform/CHIPDeviceLayer.h>
#endif

static const char *TAG = "espm_ota";

static const char *s_state = "idle";
static int64_t s_last_check; // uptime (s) of the last update check, 0: none yet
static char s_error[96];

#if ESPM_HTTP
static char s_bearer[80];
/** The app itself (`<app URL>/api/v1`), and a hub's relay once found (`http://<hub>/api/v1/relay`). */
static char s_app[160], s_hub[160];

/** Reports go through the hub whenever the device uses one: that's how the hub learns its address. */
static const char *report_base() { return ESPM_VIA_HUB && s_hub[0] ? s_hub : s_app; }

#if ESPM_VIA_HUB && ESPM_HUB_OVER_THREAD
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
        snprintf(s_hub, sizeof(s_hub), "http://[%s]:%u/api/v1/relay", addr, info.mPort);
    }
    xSemaphoreGive(s_found);
}

/** Find a hub's relay with DNS-SD (the border router proxies the hub's mDNS service). */
static bool discover_hub()
{
    if (!s_found) s_found = xSemaphoreCreateBinary();
    s_hub[0] = 0;
    esp_openthread_lock_acquire(portMAX_DELAY);
    otError err = otDnsClientResolveService(esp_openthread_get_instance(), "espm-relay",
                                            "_espm-relay._tcp.default.service.arpa.", on_resolved, nullptr, nullptr);
    esp_openthread_lock_release();
    if (err != OT_ERROR_NONE) return false;
    xSemaphoreTake(s_found, pdMS_TO_TICKS(15000));
    if (s_hub[0]) ESP_LOGI(TAG, "Hub relay at %s", s_hub);
    return s_hub[0] != 0;
}
#elif ESPM_VIA_HUB
#include <mdns.h>

/** Find a hub's relay on the LAN (mDNS). */
static bool discover_hub()
{
    s_hub[0] = 0;
    mdns_init(); // already done by Matter's DNS-SD: then a no-op
    mdns_result_t *results = nullptr;
    if (mdns_query_ptr("_espm-relay", "_tcp", 3000, 4, &results) != ESP_OK) return false;
    for (mdns_result_t *r = results; r && !s_hub[0]; r = r->next)
        for (mdns_ip_addr_t *a = r->addr; a; a = a->next)
            if (a->addr.type == ESP_IPADDR_TYPE_V4) {
                snprintf(s_hub, sizeof(s_hub), "http://" IPSTR ":%u/api/v1/relay", IP2STR(&a->addr.u_addr.ip4),
                         r->port);
                break;
            }
    mdns_query_results_free(results);
    if (s_hub[0]) ESP_LOGI(TAG, "Hub relay at %s", s_hub);
    return s_hub[0] != 0;
}
#endif

/** https:// URLs (the app on the internet) are verified against the built-in CA bundle. */
static void tls(esp_http_client_config_t &cfg)
{
    if (strncmp(cfg.url, "https://", 8) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
}

/** Tell the app what runs on a slot and how an update goes. */
void espm_update_report(const char *slot, const char *state, int version, int running, const char *message)
{
    char url[256], body[320];
    const char *base = report_base();
    if (!base[0]) return;
    snprintf(url, sizeof(url), "%s/devices/%s/report", base, ESPM_DEVICE_ID);
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
#endif

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

static esp_err_t add_auth(esp_http_client_handle_t client)
{
    return esp_http_client_set_header(client, "Authorization", s_bearer);
}

/** 204: nothing to do; 200: `{"version": n, "url": "…"}` for a new firmware. */
static bool fetch_manifest(int *version, char *image_url, size_t len)
{
    char url[256];
    snprintf(url, sizeof(url), "%s/devices/%s/update?slot=%s&version=%d", s_app, ESPM_DEVICE_ID, ESPM_SLOT,
             ESPM_FW_VERSION);
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
            if (cJSON_IsNumber(v) && cJSON_IsString(u)) {
                *version = (int)v->valuedouble;
                strlcpy(image_url, u->valuestring, len);
                found = *version != ESPM_FW_VERSION;
            }
            cJSON_Delete(json);
        }
    }
    esp_http_client_cleanup(client);
    return found;
}

static void pull_once()
{
    s_last_check = esp_timer_get_time() / 1000000;
    int version = 0;
    char image[256] = {};
    if (!fetch_manifest(&version, image, sizeof(image))) return;
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

#endif

#if ESPM_HTTP
static TaskHandle_t s_task;

#if ESPM_MATTER_OTA
/** Progress of a Matter update, for the app (reported from the task: never block the Matter task). */
struct ota_event_t {
    const char *state;
    uint32_t version;
};
static QueueHandle_t s_events;

void espm_ota_matter_event(const ChipDeviceEvent *event)
{
    using namespace chip::DeviceLayer;
    const char *state = nullptr;
    switch (event->OtaStateChanged.newState) {
    case kOtaDownloadInProgress: state = "downloading"; break;
    case kOtaApplyInProgress: state = "installing"; break;
    case kOtaApplyComplete: state = "installed"; break;
    case kOtaDownloadFailed:
    case kOtaDownloadAborted:
    case kOtaApplyFailed: state = "failed"; break;
    default: return;
    }
    s_state = state;
    auto *requestor = chip::GetRequestorInstance();
    uint32_t version = requestor ? requestor->GetTargetVersion() : 0;
    ota_event_t item = {state, version};
    if (s_events) xQueueSend(s_events, &item, 0);
}
#endif

static void report_task(void *)
{
    // Wait for the network, then report what's running (the app learns version and settings).
    while (!espm_online()) vTaskDelay(pdMS_TO_TICKS(2000));
#if ESPM_VIA_HUB
    if (ESPM_HUB_OVER_THREAD) vTaskDelay(pdMS_TO_TICKS(10000)); // let SRP/DNS settle after joining
    discover_hub();
#endif
    report("running", ESPM_FW_VERSION, nullptr);
#if ESPM_MATTER_OTA
    ota_event_t item;
    for (;;)
        if (xQueueReceive(s_events, &item, portMAX_DELAY) == pdTRUE) {
#if ESPM_VIA_HUB
            if (!s_hub[0]) discover_hub();
#endif
            report(item.state, (int)item.version, item.state[0] == 'f' ? "Matter update failed" : nullptr);
        }
#else // a hub: pulls its own
    if (!ESPM_UPDATE_PULL_ON) {
        s_task = nullptr;
        vTaskDelete(nullptr);
    }
    for (;;) {
        pull_once();
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(ESPM_UPDATE_INTERVAL_MIN * 60 * 1000));
    }
#endif
}
#endif

bool espm_ota_check_now()
{
#if ESPM_MATTER_OTA
    // Ask the default OTA providers (the hub) right away instead of at the next daily query.
    auto *requestor = chip::GetRequestorInstance();
    if (!requestor) return false;
    s_last_check = esp_timer_get_time() / 1000000;
    return espm_locked([&] { return requestor->TriggerImmediateQuery(); }) == CHIP_NO_ERROR;
#elif ESPM_UPDATE_PULL
    if (!s_task || !ESPM_UPDATE_PULL_ON) return false;
    xTaskNotifyGive(s_task);
    return true;
#else
    return false;
#endif
}

#if ESPM_HTTP
static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "version", ESPM_FW_VERSION);
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

#if ESPM_UPDATE_PULL || ESPM_MATTER_OTA
/** POST /api/v1/ota/check: the app has something new – ask for it now instead of at the next check. */
static esp_err_t check(httpd_req_t *req)
{
    if (!espm_ota_check_now()) return espm_send_error(req, 409, "this device doesn't take updates now");
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
#if ESPM_UPDATE_PULL || ESPM_MATTER_OTA
    espm_route(HTTP_POST, "/api/v1/ota/check", check);
#endif
#endif
#if ESPM_HTTP
    snprintf(s_bearer, sizeof(s_bearer), "Bearer %s", ESPM_API_TOKEN);
    if (ESPM_APP_URL[0]) snprintf(s_app, sizeof(s_app), "%s/api/v1", ESPM_APP_URL);
#if ESPM_MATTER_OTA
    s_events = xQueueCreate(4, sizeof(ota_event_t));
#endif
    if (s_app[0] || ESPM_VIA_HUB) xTaskCreate(report_task, "espm_ota", 6144, nullptr, 3, &s_task);
#endif
}
