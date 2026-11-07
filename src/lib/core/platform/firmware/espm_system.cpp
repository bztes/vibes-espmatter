// espmatter studio – /api/v1/info, /api/v1/system routes.
#include "espm.h"

#if ESPM_HTTP
#include <esp_app_desc.h>
#include <esp_chip_info.h>
#include <esp_heap_caps.h>
#include <esp_netif.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

static const char *reset_reason()
{
    switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_DEEPSLEEP: return "deep-sleep";
    default: return "other";
    }
}

static esp_err_t info(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "id", ESPM_DEVICE_ID);
    cJSON_AddStringToObject(json, "name", ESPM_DEVICE_NAME);
    cJSON_AddStringToObject(json, "kind", ESPM_DEVICE_KIND);
    cJSON *fw = cJSON_AddObjectToObject(json, "firmware");
    cJSON_AddNumberToObject(fw, "version", ESPM_FW_VERSION);
    cJSON_AddStringToObject(fw, "build", ESPM_BUILD_ID);
    cJSON_AddStringToObject(fw, "config", ESPM_CFG_REV);
    cJSON_AddStringToObject(fw, "idf", esp_get_idf_version());
    cJSON_AddStringToObject(json, "chip", CONFIG_IDF_TARGET);
    return espm_send_json(req, json);
}

static esp_err_t system(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "uptime", esp_timer_get_time() / 1000000);
    cJSON_AddStringToObject(json, "resetReason", reset_reason());
    cJSON *heap = cJSON_AddObjectToObject(json, "heap");
    cJSON_AddNumberToObject(heap, "free", heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    cJSON_AddNumberToObject(heap, "min", heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL));
    cJSON *psram = cJSON_AddObjectToObject(json, "psram");
    cJSON_AddNumberToObject(psram, "free", heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    cJSON *net = cJSON_AddObjectToObject(json, "network");
    cJSON_AddStringToObject(net, "ip", espm_ip());
#if CONFIG_ESP_WIFI_ENABLED
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) cJSON_AddNumberToObject(net, "rssi", ap.rssi);
#endif
    return espm_send_json(req, json);
}

static void restart_task(void *)
{
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
}

static esp_err_t reboot(httpd_req_t *req)
{
    espm_send_ok(req);
    xTaskCreate(restart_task, "restart", 2048, nullptr, 5, nullptr);
    return ESP_OK;
}

#if ESPM_MATTER_SERVER
static esp_err_t identify(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *seconds = cJSON_GetObjectItem(body, "seconds");
    uint16_t time = cJSON_IsNumber(seconds) ? (uint16_t)seconds->valuedouble : 10;
    cJSON_Delete(body);
    // Every endpoint with an Identify cluster.
    esp_matter_attr_val_t val = esp_matter_uint16(time);
    for (uint16_t ep = 1; ep < 32; ep++)
        if (esp_matter::cluster::get(ep, chip::app::Clusters::Identify::Id))
            espm_attr_update(ep, chip::app::Clusters::Identify::Id,
                             chip::app::Clusters::Identify::Attributes::IdentifyTime::Id, val);
    return espm_send_ok(req);
}
#endif

struct SystemRoutes {
    SystemRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/info", info, ESPM_PUBLIC);
        espm_route(HTTP_GET, "/api/v1/system", system);
        espm_route(HTTP_POST, "/api/v1/system/reboot", reboot);
#if ESPM_MATTER_SERVER
        espm_route(HTTP_POST, "/api/v1/system/identify", identify);
#endif
    }
};
static SystemRoutes s_routes;
#endif
