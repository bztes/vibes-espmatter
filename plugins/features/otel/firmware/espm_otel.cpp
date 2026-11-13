// espmatter studio – OpenTelemetry exporter (OTLP/HTTP, JSON encoding).
// Metrics: this device and every device a metric source reports (on a hub: the paired Matter
// nodes), each as a resource of its own, in batches over one keep-alive connection.
// Logs: this device's own log output (ESP_LOGx), captured by a vprintf hook into a ring buffer
// and sent every few seconds. The endpoint is the collector's base URL; /v1/metrics and
// /v1/logs are appended.
#include "espm.h"
#include "espm_otel.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/ringbuf.h>
#include <freertos/task.h>

static const char *TAG = "espm_otel";
static constexpr int RESOURCES_PER_REQUEST = 16;
static constexpr int LOGS_PER_REQUEST = 40;
static constexpr int LOG_REQUESTS_PER_TICK = 4;
static constexpr size_t LOG_BUFFER = 4096; // bytes of not yet sent log records
static constexpr size_t LOG_LINE = 192;    // longer lines are cut
static constexpr int TICK_S = 5;           // how often buffered logs are sent
static unsigned s_exports, s_failures, s_devices, s_logs_sent, s_logs_dropped;
static int s_last_status; // 0 = nothing sent yet, -1 = unreachable
static bool s_time_valid;
static char *s_metrics_url, *s_logs_url;
static TaskHandle_t s_task;
static bool s_metrics; // metrics on
static RingbufHandle_t s_logs; // null: logs off
static vprintf_like_t s_prev_vprintf;
static uint8_t s_log_min; // lowest OTLP severity number exported

static void now_ns(char *out, size_t len)
{
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    snprintf(out, len, "%lld", (long long)tv.tv_sec * 1000000000LL + tv.tv_usec * 1000LL);
}

static void add_attr(cJSON *attrs, const char *key, const char *value)
{
    cJSON *a = cJSON_CreateObject();
    cJSON_AddStringToObject(a, "key", key);
    cJSON_AddStringToObject(cJSON_AddObjectToObject(a, "value"), "stringValue", value);
    cJSON_AddItemToArray(attrs, a);
}

/** Resource attributes. service.instance.id becomes Prometheus' `instance`, so devices stay apart. */
static void resource_attrs(cJSON *owner, const char *id, const char *name, const char *matter_node_id)
{
    cJSON *attrs = cJSON_AddArrayToObject(cJSON_AddObjectToObject(owner, "resource"), "attributes");
    add_attr(attrs, "service.name", ESPM_OTEL_SERVICE[0] ? ESPM_OTEL_SERVICE : espm_hostname());
    add_attr(attrs, "service.instance.id", id);
    add_attr(attrs, "device.id", id);
    add_attr(attrs, "device.name", name);
    if (matter_node_id) {
        add_attr(attrs, "matter.node_id", matter_node_id);
        add_attr(attrs, "device.via", ESPM_DEVICE_ID);
    } else add_attr(attrs, "device.kind", ESPM_DEVICE_KIND);
}

/** One OTLP metrics request body under construction. */
struct Batch {
    cJSON *root;
    cJSON *resources;
    cJSON *metrics; // of the current resource
    int count;      // resources
    char now_ns[24];
};

static void batch_begin(Batch &b)
{
    b.root = cJSON_CreateObject();
    b.resources = cJSON_AddArrayToObject(b.root, "resourceMetrics");
    b.metrics = nullptr;
    b.count = 0;
    now_ns(b.now_ns, sizeof(b.now_ns));
}

/** Start a resource. */
static void batch_device(Batch &b, const char *id, const char *name, const char *matter_node_id)
{
    cJSON *rm = cJSON_CreateObject();
    cJSON_AddItemToArray(b.resources, rm);
    resource_attrs(rm, id, name, matter_node_id);
    cJSON *sm = cJSON_CreateObject();
    cJSON_AddItemToArray(cJSON_AddArrayToObject(rm, "scopeMetrics"), sm);
    cJSON_AddStringToObject(cJSON_AddObjectToObject(sm, "scope"), "name", "espmatter");
    b.metrics = cJSON_AddArrayToObject(sm, "metrics");
    b.count++;
}

static void batch_metric(Batch &b, const char *name, const char *labels, const char *unit, double value)
{
    if (!b.metrics) return;
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "name", name);
    cJSON_AddStringToObject(m, "unit", unit);
    cJSON *points = cJSON_AddArrayToObject(cJSON_AddObjectToObject(m, "gauge"), "dataPoints");
    cJSON *p = cJSON_CreateObject();
    cJSON_AddStringToObject(p, "timeUnixNano", b.now_ns);
    cJSON_AddNumberToObject(p, "asDouble", value);
    // labels: "k=v,k2=v2"
    if (labels && labels[0]) {
        cJSON *attrs = cJSON_AddArrayToObject(p, "attributes");
        char copy[48];
        strlcpy(copy, labels, sizeof(copy));
        for (char *save, *kv = strtok_r(copy, ",", &save); kv; kv = strtok_r(nullptr, ",", &save)) {
            char *eq = strchr(kv, '=');
            if (!eq) continue;
            *eq = 0;
            add_attr(attrs, kv, eq + 1);
        }
    }
    cJSON_AddItemToArray(points, p);
    cJSON_AddItemToArray(b.metrics, m);
}

static const espm_metric_sink_t s_sink = {
    [](void *arg, const char *id, const char *name, const char *node) { batch_device(*(Batch *)arg, id, name, node); },
    [](void *arg, const char *name, const char *labels, const char *unit, double value) {
        batch_metric(*(Batch *)arg, name, labels, unit, value);
    },
    nullptr,
};

static esp_http_client_handle_t s_client;

static esp_http_client_handle_t client()
{
    if (s_client) return s_client;
    esp_http_client_config_t cfg = {};
    cfg.url = s_metrics_url;
    cfg.method = HTTP_METHOD_POST;
    cfg.timeout_ms = 10000;
    cfg.keep_alive_enable = true;
    if (strncmp(s_metrics_url, "https", 5) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
    s_client = esp_http_client_init(&cfg);
    if (!s_client) return nullptr;
    esp_http_client_set_header(s_client, "Content-Type", "application/json");
    if (ESPM_OTEL_AUTH[0]) esp_http_client_set_header(s_client, "Authorization", ESPM_OTEL_AUTH);
    return s_client;
}

/** Send and free a request body. Metrics and logs share the connection (same host). */
static bool send(cJSON *root, const char *url)
{
    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!body) return false;
    esp_http_client_handle_t c = client();
    esp_err_t err = ESP_FAIL;
    if (c) {
        esp_http_client_set_url(c, url);
        esp_http_client_set_post_field(c, body, strlen(body));
        err = esp_http_client_perform(c);
    }
    s_last_status = err == ESP_OK ? esp_http_client_get_status_code(c) : -1;
    cJSON_free(body);
    if (err != ESP_OK && s_client) { // start over with a fresh connection next time
        esp_http_client_cleanup(s_client);
        s_client = nullptr;
    }
    bool ok = s_last_status >= 200 && s_last_status < 300;
    if (!ok) ESP_LOGW(TAG, "Export failed (%d)", s_last_status);
    return ok;
}

static bool send(Batch &b)
{
    cJSON *root = b.root;
    b.root = nullptr;
    return send(root, s_metrics_url);
}

static void export_metrics()
{
    Batch b;
    batch_begin(b);
    espm_metric_sink_t own = s_sink;
    own.arg = &b;
    espm_metrics_own_report(&own);
    bool ok = true;
    int devices = espm_metrics_remote_count();
    for (int i = 0; i < devices; i++) {
        if (b.count >= RESOURCES_PER_REQUEST) {
            ok &= send(b);
            batch_begin(b);
        }
        espm_metric_sink_t sink = s_sink;
        sink.arg = &b;
        espm_metrics_remote_report(i, &sink);
    }
    ok &= send(b);
    s_devices = 1 + devices;
    if (ok) s_exports++;
    else s_failures++;
}

// ---- Logs ----

/** A buffered log record; tag and body follow as two NUL-terminated strings. */
struct LogItem {
    int64_t mono_us; // esp_timer time: turned into real time when sent, so records from before SNTP keep theirs
    uint8_t severity;
    char text[];
};

/** OTLP severity number of an ESP log level letter; 0 for none. */
static uint8_t severity_of(char level)
{
    switch (level) {
    case 'E': return 17; // ERROR
    case 'W': return 13; // WARN
    case 'I': return 9;  // INFO
    case 'D': return 5;  // DEBUG
    case 'V': return 1;  // TRACE
    default: return 0;
    }
}

static const char *severity_text(uint8_t s)
{
    return s >= 17 ? "ERROR" : s >= 13 ? "WARN" : s >= 9 ? "INFO" : s >= 5 ? "DEBUG" : "TRACE";
}

/** Skips a leading ANSI color sequence ("\033[0;31m"). */
static const char *skip_color(const char *p)
{
    if (*p != '\033') return p;
    const char *m = strchr(p, 'm');
    return m ? m + 1 : p;
}

/**
 * vprintf hook. Log v1 formats a whole line in one call: [color]"L (ms) tag: message"[reset]"\n".
 * The level is read from the format string first, so filtered lines cost no formatting.
 */
static int log_vprintf(const char *fmt, va_list args)
{
    va_list copy;
    va_copy(copy, args);
    int ret = s_prev_vprintf(fmt, args);
    uint8_t severity = severity_of(*skip_color(fmt));
    // Our own task's lines (HTTP client errors while the collector is down) would only feed themselves.
    if (severity < s_log_min || xTaskGetCurrentTaskHandle() == s_task) {
        va_end(copy);
        return ret;
    }
    char line[LOG_LINE];
    vsnprintf(line, sizeof(line), fmt, copy);
    va_end(copy);

    const char *p = skip_color(line) + 1;
    const char *tag = "", *body = p;
    size_t tag_len = 0;
    if (const char *close = strstr(p, ") ")) {
        tag = close + 2;
        if (const char *colon = strstr(tag, ": ")) {
            tag_len = colon - tag;
            body = colon + 2;
        } else tag = "";
    }
    size_t body_len = strlen(body);
    while (body_len && (body[body_len - 1] == '\n' || body[body_len - 1] == '\r')) body_len--;
    if (body_len >= 4 && memcmp(body + body_len - 4, "\033[0m", 4) == 0) body_len -= 4;

    size_t size = sizeof(LogItem) + tag_len + 1 + body_len + 1;
    LogItem *item;
    if (xRingbufferSendAcquire(s_logs, (void **)&item, size, 0) != pdTRUE) {
        s_logs_dropped++;
        return ret;
    }
    item->mono_us = esp_timer_get_time();
    item->severity = severity;
    memcpy(item->text, tag, tag_len);
    item->text[tag_len] = 0;
    memcpy(item->text + tag_len + 1, body, body_len);
    item->text[tag_len + 1 + body_len] = 0;
    xRingbufferSendComplete(s_logs, item);
    return ret;
}

/** Sends up to LOGS_PER_REQUEST buffered records; false when there was nothing or it failed. */
static bool export_logs_once()
{
    size_t size;
    LogItem *item = (LogItem *)xRingbufferReceive(s_logs, &size, 0);
    if (!item) return false;

    struct timeval tv;
    gettimeofday(&tv, nullptr);
    int64_t real_us = (int64_t)tv.tv_sec * 1000000 + tv.tv_usec, mono_us = esp_timer_get_time();
    char observed[24], ts[24];
    now_ns(observed, sizeof(observed));

    cJSON *root = cJSON_CreateObject();
    cJSON *rl = cJSON_CreateObject();
    cJSON_AddItemToArray(cJSON_AddArrayToObject(root, "resourceLogs"), rl);
    resource_attrs(rl, ESPM_DEVICE_ID, ESPM_DEVICE_NAME, nullptr);
    cJSON *sl = cJSON_CreateObject();
    cJSON_AddItemToArray(cJSON_AddArrayToObject(rl, "scopeLogs"), sl);
    cJSON_AddStringToObject(cJSON_AddObjectToObject(sl, "scope"), "name", "espmatter");
    cJSON *records = cJSON_AddArrayToObject(sl, "logRecords");
    int n = 0;
    while (item) {
        cJSON *r = cJSON_CreateObject();
        snprintf(ts, sizeof(ts), "%lld", (long long)(real_us - (mono_us - item->mono_us)) * 1000LL);
        cJSON_AddStringToObject(r, "timeUnixNano", ts);
        cJSON_AddStringToObject(r, "observedTimeUnixNano", observed);
        cJSON_AddNumberToObject(r, "severityNumber", item->severity);
        cJSON_AddStringToObject(r, "severityText", severity_text(item->severity));
        const char *tag = item->text, *body = tag + strlen(tag) + 1;
        cJSON_AddStringToObject(cJSON_AddObjectToObject(r, "body"), "stringValue", body);
        if (tag[0]) add_attr(cJSON_AddArrayToObject(r, "attributes"), "log.tag", tag);
        cJSON_AddItemToArray(records, r);
        vRingbufferReturnItem(s_logs, item);
        if (++n >= LOGS_PER_REQUEST) break;
        item = (LogItem *)xRingbufferReceive(s_logs, &size, 0);
    }
    bool ok = send(root, s_logs_url);
    if (ok) s_logs_sent += n;
    else s_logs_dropped += n; // no retry: a collector that is down would only fill the buffer
    return ok && n >= LOGS_PER_REQUEST;
}

static void export_logs()
{
    for (int i = 0; i < LOG_REQUESTS_PER_TICK && export_logs_once(); i++) {
    }
}

static uint8_t log_min_severity()
{
    const char *level = ESPM_OTEL_LOG_LEVEL;
    if (strcmp(level, "error") == 0) return 17;
    if (strcmp(level, "info") == 0) return 9;
    if (strcmp(level, "debug") == 0) return 5;
    return 13; // warn
}

// ---- Task ----

static void task(void *)
{
    int64_t next_metrics_us = 0;
    for (;;) {
        // Data points need a real timestamp – backends drop samples from 1970. Logs wait in the buffer.
        if (!s_time_valid && !(s_time_valid = espm_time_valid())) {
            ESP_LOGI(TAG, "Waiting for the time (SNTP %s)", ESPM_OTEL_NTP);
            vTaskDelay(pdMS_TO_TICKS(TICK_S * 1000));
            continue;
        }
        if (s_metrics && esp_timer_get_time() >= next_metrics_us) {
            next_metrics_us = esp_timer_get_time() + (int64_t)ESPM_OTEL_INTERVAL_S * 1000000;
            export_metrics();
        }
        if (s_logs) export_logs();
        int64_t wait_us = s_metrics ? next_metrics_us - esp_timer_get_time() : INT64_MAX;
        if (s_logs && wait_us > TICK_S * 1000000LL) wait_us = TICK_S * 1000000LL;
        vTaskDelay(pdMS_TO_TICKS(wait_us > 0 ? wait_us / 1000 : 0) + 1);
    }
}

#if ESPM_HTTP
static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "endpoint", ESPM_OTEL_ENDPOINT);
    cJSON_AddBoolToObject(json, "timeSynced", s_time_valid);
    cJSON_AddNumberToObject(json, "devices", s_devices);
    cJSON_AddNumberToObject(json, "exports", s_exports);
    cJSON_AddNumberToObject(json, "failures", s_failures);
    cJSON_AddNumberToObject(json, "lastStatus", s_last_status);
    cJSON_AddBoolToObject(json, "metrics", s_metrics);
    cJSON_AddBoolToObject(json, "logs", s_logs != nullptr);
    cJSON_AddNumberToObject(json, "logsSent", s_logs_sent);
    cJSON_AddNumberToObject(json, "logsDropped", s_logs_dropped);
    return espm_send_json(req, json);
}
struct OtelRoutes {
    OtelRoutes() { espm_route(HTTP_GET, "/api/v1/otel", status); }
};
static OtelRoutes s_routes;
#endif

/** "<base>/v1/<signal>"; a base that already ends in /v1/metrics (older configs) is cut back. */
static char *signal_url(const char *signal)
{
    const char *base = ESPM_OTEL_ENDPOINT;
    size_t len = strlen(base);
    while (len && base[len - 1] == '/') len--;
    static const char *const known[] = {"/v1/metrics", "/v1/logs", "/v1/traces"};
    for (const char *k : known) {
        size_t kl = strlen(k);
        if (len >= kl && strncmp(base + len - kl, k, kl) == 0) {
            len -= kl;
            break;
        }
    }
    char *url = nullptr;
    if (asprintf(&url, "%.*s/v1/%s", (int)len, base, signal) < 0) return nullptr;
    return url;
}

void espm_otel_start()
{
    s_metrics_url = signal_url("metrics");
    s_logs_url = signal_url("logs");
    if (!s_metrics_url || !s_logs_url) {
        ESP_LOGE(TAG, "Out of memory");
        return;
    }
    espm_time_sync(ESPM_OTEL_NTP);
    s_metrics = ESPM_OTEL_METRICS;
    if (ESPM_OTEL_LOGS) {
        s_log_min = log_min_severity();
        s_logs = xRingbufferCreate(LOG_BUFFER, RINGBUF_TYPE_NOSPLIT);
        if (s_logs) s_prev_vprintf = esp_log_set_vprintf(log_vprintf);
        else ESP_LOGW(TAG, "No memory for the log buffer: logs are not exported");
    }
    if (!s_metrics && !s_logs) {
        ESP_LOGI(TAG, "Metrics and logs off: nothing to export");
        return;
    }
    xTaskCreate(task, "espm_otel", 6144, nullptr, 2, &s_task);
}
