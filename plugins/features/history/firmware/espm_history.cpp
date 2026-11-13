// espmatter studio – history: past values of this device and its paired devices, read from the
// database behind the OpenTelemetry collector. The firmware runs a fixed query per source and
// passes the answer through unchanged; the web interface reads it.
//   GET /api/v1/history/series  what can be asked for (and the source)
//   GET /api/v1/history?device=&metric=&labels=&from=&to=  one series, raw answer of the database
#include "espm.h"
#include "espm_history.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>

static const char *TAG = "espm_history";
static constexpr int MAX_POINTS = 400;
static constexpr int MIN_STEP_S = 60;
static constexpr long long MAX_RANGE_S = 10LL * 366 * 86400;

#if ESPM_HTTP

/** Ids, metric names and labels: what the exporter sends, nothing that needs quoting. */
static bool plain(const char *s, size_t max, bool empty_ok)
{
    size_t n = strlen(s);
    if (n >= max || (!n && !empty_ok)) return false;
    for (; *s; s++)
        if (!isalnum((unsigned char)*s) && !strchr("._/=,:-", *s)) return false;
    return true;
}

/** Query parameter `key`, URL-decoded. */
static bool query_param(const char *query, const char *key, char *out, size_t len)
{
    char raw[160];
    if (httpd_query_key_value(query, key, raw, sizeof(raw)) != ESP_OK) return false;
    size_t o = 0;
    for (const char *p = raw; *p && o + 1 < len; p++) {
        if (*p == '%' && isxdigit((unsigned char)p[1]) && isxdigit((unsigned char)p[2])) {
            char hex[3] = {p[1], p[2], 0};
            out[o++] = (char)strtol(hex, nullptr, 16);
            p += 2;
        } else out[o++] = *p == '+' ? ' ' : *p;
    }
    out[o] = 0;
    return true;
}

/** `labels` names an endpoint (`endpoint=<n>`): its number, else -1. */
static int endpoint_of(const char *labels)
{
    const char *p = strstr(labels, "endpoint=");
    if (!p || (p != labels && p[-1] != ',')) return -1;
    return atoi(p + 9);
}

/** The caller may read a series of paired node `node` (decimal id). */
static bool node_visible(const char *node, const char *labels)
{
    char res[40];
    int ep = endpoint_of(labels);
    if (ep < 0) {
        snprintf(res, sizeof(res), "n%s", node);
        return espm_permission_any(res);
    }
    snprintf(res, sizeof(res), "n%s.%d", node, ep);
    return espm_permission(res) != ESPM_PERM_NONE;
}

// ---- Series ----

struct Lister {
    cJSON *devices;
    cJSON *series; // of the current device; null: not visible
    char node[24];
};

static void add_series(cJSON *series, const char *metric, const char *labels, const char *unit, double value)
{
    cJSON *s = cJSON_CreateObject();
    cJSON_AddStringToObject(s, "metric", metric);
    cJSON_AddStringToObject(s, "labels", labels);
    cJSON_AddStringToObject(s, "unit", unit);
    cJSON_AddNumberToObject(s, "value", value);
    cJSON_AddItemToArray(series, s);
}

/** `node`: a paired device's Matter node id; empty: none. */
static cJSON *add_device(cJSON *devices, const char *id, const char *name, const char *node)
{
    cJSON *d = cJSON_CreateObject();
    cJSON_AddStringToObject(d, "id", id);
    cJSON_AddStringToObject(d, "name", name);
    cJSON_AddBoolToObject(d, "own", strcmp(id, ESPM_DEVICE_ID) == 0);
    if (node[0]) cJSON_AddStringToObject(d, "node", node);
    cJSON_AddItemToArray(devices, d);
    return cJSON_AddArrayToObject(d, "series");
}

static void list_device(void *arg, const char *id, const char *name, const char *node)
{
    Lister &l = *(Lister *)arg;
    strlcpy(l.node, node ? node : "", sizeof(l.node));
    char res[32];
    snprintf(res, sizeof(res), "n%s", l.node);
    bool visible = l.node[0] ? espm_permission_any(res) : espm_caller_admin();
    l.series = visible ? add_device(l.devices, id, name, l.node) : nullptr;
}

static void list_metric(void *arg, const char *name, const char *labels, const char *unit, double value)
{
    Lister &l = *(Lister *)arg;
    if (!l.series || (l.node[0] && !node_visible(l.node, labels))) return;
    add_series(l.series, name, labels, unit, value);
}

static esp_err_t series(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "source", ESPM_HISTORY_SOURCE);
    cJSON *devices = cJSON_AddArrayToObject(json, "devices");
    // What the exporter sends: this device, then the remote ones.
    Lister l = {devices, nullptr, {}};
    espm_metric_sink_t sink = {list_device, list_metric, &l};
    espm_metrics_own_report(&sink);
    int remotes = espm_metrics_remote_count();
    for (int i = 0; i < remotes; i++) espm_metrics_remote_report(i, &sink);
    return espm_send_json(req, json);
}

// ---- One series ----

struct Finder {
    const char *id;
    bool found;
    char node[24];
};

static void find_device(void *arg, const char *id, const char *, const char *node)
{
    Finder &f = *(Finder *)arg;
    if (f.found || strcmp(id, f.id)) return;
    f.found = true;
    strlcpy(f.node, node ? node : "", sizeof(f.node));
}

/** 404 / 403 sent unless the caller may read this series. */
static bool allowed(httpd_req_t *req, const char *device, const char *labels)
{
    bool ok = espm_caller_admin();
    if (strcmp(device, ESPM_DEVICE_ID) != 0) {
        Finder f = {device, false, {}};
        espm_metric_sink_t sink = {find_device, [](void *, const char *, const char *, const char *, double) {}, &f};
        int remotes = espm_metrics_remote_count();
        for (int i = 0; i < remotes && !f.found; i++) espm_metrics_remote_report(i, &sink);
        if (!f.found) {
            espm_send_error(req, 404, "unknown device");
            return false;
        }
        if (f.node[0]) ok = node_visible(f.node, labels);
    }
    if (!ok) espm_send_error(req, 403, "forbidden");
    return ok;
}

static void url_encode(const char *in, char *out, size_t len)
{
    size_t o = 0;
    for (; *in && o + 4 < len; in++) {
        if (isalnum((unsigned char)*in) || strchr("-_.~", *in)) out[o++] = *in;
        else o += snprintf(out + o, len - o, "%%%02X", (unsigned char)*in);
    }
    out[o] = 0;
}

static void append(char *buf, size_t len, const char *key, const char *value)
{
    char enc[256];
    url_encode(value, enc, sizeof(enc));
    size_t n = strlen(buf);
    snprintf(buf + n, len - n, "%s%s=%s", strchr(buf, '?') ? "&" : "?", key, enc);
}

static void append_num(char *buf, size_t len, const char *key, long long value)
{
    char num[24];
    snprintf(num, sizeof(num), "%lld", value);
    append(buf, len, key, num);
}

struct Request {
    char url[768];
    char *body; // freed by the caller
};

#if ESPM_HISTORY_CLICKHOUSE
/** Gauges as the collector's ClickHouse exporter stores them; values only as query parameters. */
static const char *CLICKHOUSE_SQL =
    "SELECT toUInt32(toStartOfInterval(toDateTime(TimeUnix), INTERVAL {step:UInt32} SECOND)) AS t,"
    " avg(Value), min(Value), max(Value) FROM %s"
    " WHERE ResourceAttributes['service.instance.id'] = {device:String} AND MetricName = {metric:String}"
    " AND hasAll(arrayMap((k, v) -> concat(k, '=', v), mapKeys(Attributes), mapValues(Attributes)),"
    " {labels:Array(String)})"
    " AND TimeUnix >= toDateTime({from:UInt32}) AND TimeUnix < toDateTime({to:UInt32})"
    " GROUP BY t ORDER BY t FORMAT JSONCompact";

/** `db.table` or `table`: it goes into the query as is. */
static bool table_name(const char *s)
{
    int dots = 0;
    if (!*s || *s == '.') return false;
    for (; *s; s++) {
        if (*s == '.') {
            if (++dots > 1 || !s[1]) return false;
        } else if (!isalnum((unsigned char)*s) && *s != '_') return false;
    }
    return true;
}

static bool build(Request &r, const char *device, const char *metric, const char *labels, long long from,
                  long long to, long long step)
{
    const char *table = ESPM_HISTORY_TABLE;
    if (!table_name(table)) return false;
    if (asprintf(&r.body, CLICKHOUSE_SQL, table) < 0) return false;

    // Array(String) literal: ['k=v','k2=v2'] – the values contain no quotes (plain()).
    char arr[128] = "[";
    char copy[48];
    strlcpy(copy, labels, sizeof(copy));
    for (char *save, *kv = strtok_r(copy, ",", &save); kv; kv = strtok_r(nullptr, ",", &save)) {
        size_t n = strlen(arr);
        snprintf(arr + n, sizeof(arr) - n, "%s'%s'", n > 1 ? "," : "", kv);
    }
    strlcat(arr, "]", sizeof(arr));

    snprintf(r.url, sizeof(r.url), "%s", ESPM_HISTORY_URL);
    size_t n = strlen(r.url);
    while (n && r.url[n - 1] == '/') r.url[--n] = 0;
    strlcat(r.url, "/", sizeof(r.url));
    append(r.url, sizeof(r.url), "param_device", device);
    append(r.url, sizeof(r.url), "param_metric", metric);
    append(r.url, sizeof(r.url), "param_labels", arr);
    append_num(r.url, sizeof(r.url), "param_from", from);
    append_num(r.url, sizeof(r.url), "param_to", to);
    append_num(r.url, sizeof(r.url), "param_step", step);
    return true;
}

static void auth(esp_http_client_handle_t c)
{
    if (ESPM_HISTORY_USER[0]) esp_http_client_set_header(c, "X-ClickHouse-User", ESPM_HISTORY_USER);
    if (ESPM_HISTORY_PASSWORD[0]) esp_http_client_set_header(c, "X-ClickHouse-Key", ESPM_HISTORY_PASSWORD);
}
#else
#error "history: no source"
#endif

/** The database's error text, cut to one line. */
static esp_err_t upstream_error(httpd_req_t *req, esp_http_client_handle_t c, int status)
{
    char msg[200];
    int n = esp_http_client_read(c, msg, sizeof(msg) - 1);
    msg[n > 0 ? n : 0] = 0;
    if (char *nl = strpbrk(msg, "\r\n")) *nl = 0;
    char text[240];
    snprintf(text, sizeof(text), "%s answered %d%s%s", ESPM_HISTORY_SOURCE, status, msg[0] ? ": " : "", msg);
    ESP_LOGW(TAG, "%s", text);
    esp_http_client_cleanup(c);
    return espm_send_error(req, 502, text);
}

static esp_err_t history(httpd_req_t *req)
{
    char query[512], device[64] = "", metric[32] = "", labels[48] = "", from_s[16] = "", to_s[16] = "";
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) query[0] = 0;
    query_param(query, "device", device, sizeof(device));
    query_param(query, "metric", metric, sizeof(metric));
    query_param(query, "labels", labels, sizeof(labels));
    query_param(query, "from", from_s, sizeof(from_s));
    query_param(query, "to", to_s, sizeof(to_s));
    long long from = atoll(from_s), to = atoll(to_s);
    if (!plain(device, sizeof(device), false) || !plain(metric, sizeof(metric), false) ||
        !plain(labels, sizeof(labels), true) || from <= 0 || to <= from || to - from > MAX_RANGE_S)
        return espm_send_error(req, 400, "device, metric, from and to (unix seconds) needed");
    if (!allowed(req, device, labels)) return ESP_OK;
    long long step = (to - from + MAX_POINTS - 1) / MAX_POINTS;
    if (step < MIN_STEP_S) step = MIN_STEP_S;

    Request r = {};
    if (!build(r, device, metric, labels, from, to, step)) {
        free(r.body);
        return espm_send_error(req, 500, "history source not set up (URL, table)");
    }
    esp_http_client_config_t cfg = {};
    cfg.url = r.url;
    cfg.method = HTTP_METHOD_POST;
    cfg.timeout_ms = 8000;
    cfg.buffer_size = 2048;
    cfg.buffer_size_tx = 1024;
    if (strncmp(r.url, "https://", 8) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) {
        free(r.body);
        return espm_send_error(req, 500, "out of memory");
    }
    esp_http_client_set_header(c, "Content-Type", "text/plain");
    auth(c);
    size_t len = strlen(r.body);
    esp_err_t err = esp_http_client_open(c, len);
    if (err == ESP_OK && esp_http_client_write(c, r.body, len) != (int)len) err = ESP_FAIL;
    free(r.body);
    if (err != ESP_OK) {
        esp_http_client_cleanup(c);
        return espm_send_error(req, 502, ESPM_HISTORY_SOURCE " unreachable");
    }
    esp_http_client_fetch_headers(c);
    int status = esp_http_client_get_status_code(c);
    if (status != 200) return upstream_error(req, c, status);

    httpd_resp_set_type(req, "application/json");
    static char buf[1024];
    int n;
    while ((n = esp_http_client_read(c, buf, sizeof(buf))) > 0)
        if (httpd_resp_send_chunk(req, buf, n) != ESP_OK) break;
    esp_http_client_cleanup(c);
    return httpd_resp_send_chunk(req, nullptr, 0);
}
#endif

void espm_history_init()
{
#if ESPM_HTTP
    espm_route(HTTP_GET, "/api/v1/history/series", series, ESPM_ACCOUNT);
    espm_route(HTTP_GET, "/api/v1/history", history, ESPM_ACCOUNT);
#endif
}
