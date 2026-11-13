// espmatter studio – metric registry (GET /api/v1/metrics). Peripherals set values, exporters read them.
#include "espm.h"

#include <stdlib.h>
#include <string.h>
#include <esp_heap_caps.h>
#include <esp_timer.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>

#define MAX_METRICS 32

static espm_metric_t s_metrics[MAX_METRICS];
static int s_count;
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;

void espm_metric_set(const char *name, const char *labels, const char *unit, double value)
{
    portENTER_CRITICAL(&s_lock);
    int i = 0;
    while (i < s_count && (strcmp(s_metrics[i].name, name) || strcmp(s_metrics[i].labels, labels))) i++;
    if (i == s_count && s_count < MAX_METRICS) {
        s_count++;
        strlcpy(s_metrics[i].name, name, sizeof(s_metrics[i].name));
        strlcpy(s_metrics[i].labels, labels, sizeof(s_metrics[i].labels));
        strlcpy(s_metrics[i].unit, unit, sizeof(s_metrics[i].unit));
    }
    if (i < s_count) {
        s_metrics[i].value = value;
        s_metrics[i].updated_us = esp_timer_get_time();
    }
    portEXIT_CRITICAL(&s_lock);
}

int espm_metrics_snapshot(espm_metric_t *out, int max)
{
    portENTER_CRITICAL(&s_lock);
    int n = s_count < max ? s_count : max;
    memcpy(out, s_metrics, n * sizeof(espm_metric_t));
    portEXIT_CRITICAL(&s_lock);
    return n;
}

static const espm_metric_source_t *s_sources[4];
static int s_nsources;

void espm_metrics_add_source(const espm_metric_source_t *source)
{
    if (s_nsources < 4) s_sources[s_nsources++] = source;
}

int espm_metrics_remote_count()
{
    int n = 0;
    for (int i = 0; i < s_nsources; i++) n += s_sources[i]->count();
    return n;
}

void espm_metrics_remote_report(int index, const espm_metric_sink_t *sink)
{
    for (int i = 0; i < s_nsources; i++) {
        int n = s_sources[i]->count();
        if (index < n) return s_sources[i]->report(index, sink);
        index -= n;
    }
}

void espm_metrics_own_report(const espm_metric_sink_t *sink)
{
    void *a = sink->arg;
    sink->device(a, ESPM_DEVICE_ID, ESPM_DEVICE_NAME, nullptr);
    sink->metric(a, "device.uptime", "", "s", esp_timer_get_time() / 1e6);
    sink->metric(a, "device.memory.free", "", "By", heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    sink->metric(a, "device.memory.min_free", "", "By", heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL));
#if CONFIG_ESP_WIFI_ENABLED
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) sink->metric(a, "device.wifi.rssi", "", "dBm", ap.rssi);
#endif
    // On the heap: called from several tasks, and only now and then.
    auto *snap = (espm_metric_t *)malloc(sizeof(espm_metric_t) * MAX_METRICS);
    if (!snap) return;
    int n = espm_metrics_snapshot(snap, MAX_METRICS);
    for (int i = 0; i < n; i++) sink->metric(a, snap[i].name, snap[i].labels, snap[i].unit, snap[i].value);
    free(snap);
}

#if ESPM_HTTP
static esp_err_t list(httpd_req_t *req)
{
    static espm_metric_t snap[MAX_METRICS];
    int n = espm_metrics_snapshot(snap, MAX_METRICS);
    cJSON *json = cJSON_CreateObject();
    cJSON *arr = cJSON_AddArrayToObject(json, "metrics");
    for (int i = 0; i < n; i++) {
        cJSON *m = cJSON_CreateObject();
        cJSON_AddStringToObject(m, "name", snap[i].name);
        cJSON_AddStringToObject(m, "labels", snap[i].labels);
        cJSON_AddStringToObject(m, "unit", snap[i].unit);
        cJSON_AddNumberToObject(m, "value", snap[i].value);
        cJSON_AddItemToArray(arr, m);
    }
    return espm_send_json(req, json);
}
#endif

void espm_metrics_init()
{
#if ESPM_HTTP
    espm_route(HTTP_GET, "/api/v1/metrics", list);
#endif
}
