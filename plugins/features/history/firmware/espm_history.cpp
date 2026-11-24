// espmatter studio – history: past values of this device and its paired devices, read from the
// database behind the OpenTelemetry collector. The firmware runs a fixed query per source and
// passes the answer through unchanged; the web interface reads it.
//   GET /api/v1/history/series  what can be asked for (and the source)
//   GET /api/v1/history?device=&from=&to=&points=&diagnostics=  all values of a device, raw answer
//       of the database; with &metric=&labels= only that one
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
static constexpr int MAX_SERIES = 32;

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

static void add_series(cJSON *series, const char *metric, const char *labels, const char *unit, double value,
                       espm_metric_kind_t kind)
{
    cJSON *s = cJSON_CreateObject();
    cJSON_AddStringToObject(s, "metric", metric);
    cJSON_AddStringToObject(s, "labels", labels);
    cJSON_AddStringToObject(s, "unit", unit);
    cJSON_AddNumberToObject(s, "value", value);
    cJSON_AddStringToObject(s, "kind", espm_metric_kind_name(kind));
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

static void list_metric(void *arg, const char *name, const char *labels, const char *unit, double value,
                        espm_metric_kind_t kind)
{
    Lister &l = *(Lister *)arg;
    if (!l.series || (l.node[0] && !node_visible(l.node, labels))) return;
    add_series(l.series, name, labels, unit, value, kind);
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

// ---- One device ----

/** One device's metrics; `in` while they are reported. */
struct Walk {
    const char *id;
    bool in, found;
    char node[24];
};

static void walk_device(void *arg, const char *id, const char *, const char *node)
{
    Walk &w = *(Walk *)arg;
    w.in = !w.found && strcmp(id, w.id) == 0;
    if (!w.in) return;
    w.found = true;
    strlcpy(w.node, node ? node : "", sizeof(w.node));
}

/** Reports device `w.id` to `metric` (its arg is `&w`); false: unknown device. */
static bool walk(Walk &w, decltype(espm_metric_sink_t::metric) metric)
{
    espm_metric_sink_t sink = {walk_device, metric, &w};
    bool own = strcmp(w.id, ESPM_DEVICE_ID) == 0;
    if (own) espm_metrics_own_report(&sink);
    int remotes = own ? 0 : espm_metrics_remote_count();
    for (int i = 0; i < remotes && !w.found; i++) espm_metrics_remote_report(i, &sink);
    return w.found;
}

/** The caller may read this series of the walked device. */
static bool series_visible(const Walk &w, const char *labels)
{
    return w.node[0] ? node_visible(w.node, labels) : espm_caller_admin();
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

/** Bucket length for `points` buckets over the range. */
static long long step_of(long long from, long long to, int points)
{
    long long step = (to - from + points - 1) / points;
    return step < MIN_STEP_S ? MIN_STEP_S : step;
}

/** `?points=`: fewer buckets for small charts, within [20, MAX_POINTS]. */
static int points_param(const char *query)
{
    char s[8] = "";
    query_param(query, "points", s, sizeof(s));
    int n = atoi(s);
    return n <= 0 || n > MAX_POINTS ? MAX_POINTS : n < 20 ? 20 : n;
}

/** Series of a device, as SQL literals of the query. */
struct Picked {
    char keys[MAX_SERIES * 88];     // ['metric|labels', …]
    char metrics[MAX_SERIES * 36];  // ['metric', …]
    char labels[MAX_SERIES * 96];   // [['k=v', …], …]
    char counters[MAX_SERIES * 2 + 2]; // [0, 1, …]
    int count;
};

static void literal_add(char *lit, size_t len, const char *item)
{
    size_t n = strlen(lit);
    snprintf(lit + n, len - n, "%s%s", n > 1 ? "," : "", item);
}

/** `k=v,k2=v2` as `['k=v','k2=v2']` – the values contain no quotes (plain()). */
static void labels_literal(const char *labels, char *out, size_t len)
{
    strlcpy(out, "[", len);
    char copy[48], item[52];
    strlcpy(copy, labels, sizeof(copy));
    for (char *save, *kv = strtok_r(copy, ",", &save); kv; kv = strtok_r(nullptr, ",", &save)) {
        snprintf(item, sizeof(item), "'%s'", kv);
        literal_add(out, len, item);
    }
    strlcat(out, "]", len);
}

static void pick(Picked &p, const char *metric, const char *labels, bool counter)
{
    char item[128];
    snprintf(item, sizeof(item), "'%s|%s'", metric, labels);
    literal_add(p.keys, sizeof(p.keys), item);
    snprintf(item, sizeof(item), "'%s'", metric);
    literal_add(p.metrics, sizeof(p.metrics), item);
    labels_literal(labels, item, sizeof(item));
    literal_add(p.labels, sizeof(p.labels), item);
    literal_add(p.counters, sizeof(p.counters), counter ? "1" : "0");
    p.count++;
}

/** Empty literals, on the heap (several KB); null: out of memory. */
static Picked *picked_new()
{
    Picked *p = (Picked *)calloc(1, sizeof(Picked));
    if (!p) return nullptr;
    strcpy(p->keys, "[");
    strcpy(p->metrics, "[");
    strcpy(p->labels, "[");
    strcpy(p->counters, "[");
    return p;
}

static void picked_close(Picked &p)
{
    strlcat(p.keys, "]", sizeof(p.keys));
    strlcat(p.metrics, "]", sizeof(p.metrics));
    strlcat(p.labels, "]", sizeof(p.labels));
    strlcat(p.counters, "]", sizeof(p.counters));
}

#if ESPM_HISTORY_CLICKHOUSE
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

/** Rows of one table (`%s_<kind>`) with the index of the picked series they belong to (0: none). */
#define CLICKHOUSE_DEVICE_PART(counter, kind)                                                         \
    "SELECT TimeUnix, Value,"                                                                       \
    " arrayMap((k, v) -> concat(k, '=', v), mapKeys(Attributes), mapValues(Attributes)) AS kv,"     \
    " arrayFirstIndex((m, l, c) -> c = " counter " AND m = MetricName AND hasAll(kv, l), sm, sl, sc)" \
    " AS s FROM %s_" kind                                                                           \
    " WHERE ResourceAttributes['service.instance.id'] = {device:String} AND has(sm, MetricName)"    \
    " AND TimeUnix >= toDateTime({from:UInt32}) AND TimeUnix < toDateTime({to:UInt32})"

/** All picked series of a device: rows of `[key, t, avg, min, max, last]`, by key and time. */
static const char *CLICKHOUSE_DEVICE_SQL =
    "WITH CAST(%s AS Array(String)) AS sk, CAST(%s AS Array(String)) AS sm,"
    " CAST(%s AS Array(Array(String))) AS sl, CAST(%s AS Array(UInt8)) AS sc"
    " SELECT sk[s] AS key,"
    " toUInt32(toStartOfInterval(toDateTime(TimeUnix), INTERVAL {step:UInt32} SECOND)) AS t,"
    " avg(Value), min(Value), max(Value), argMax(Value, TimeUnix)"
    " FROM (" CLICKHOUSE_DEVICE_PART("0", "gauge") " UNION ALL " CLICKHOUSE_DEVICE_PART("1", "sum") ")"
    " WHERE s > 0 GROUP BY s, t ORDER BY s, t FORMAT JSONCompact";

/** URL of the database with the parameters every query has. */
static void base_url(Request &r, const char *device, long long from, long long to, long long step)
{
    snprintf(r.url, sizeof(r.url), "%s", ESPM_HISTORY_URL);
    size_t n = strlen(r.url);
    while (n && r.url[n - 1] == '/') r.url[--n] = 0;
    strlcat(r.url, "/", sizeof(r.url));
    append(r.url, sizeof(r.url), "param_device", device);
    append_num(r.url, sizeof(r.url), "param_from", from);
    append_num(r.url, sizeof(r.url), "param_to", to);
    append_num(r.url, sizeof(r.url), "param_step", step);
}

static bool build(Request &r, const char *device, const Picked &p, long long from, long long to,
                         long long step)
{
    const char *table = ESPM_HISTORY_TABLE;
    if (!table_name(table)) return false;
    if (asprintf(&r.body, CLICKHOUSE_DEVICE_SQL, p.keys, p.metrics, p.labels, p.counters, table, table) < 0)
        return false;
    base_url(r, device, from, to, step);
    return true;
}

static const char EMPTY_ANSWER[] = "{\"data\":[]}";

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

/** Sends the request to the database and passes its answer through; frees the body. */
static esp_err_t forward(httpd_req_t *req, Request &r)
{
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

/** `from` and `to` of the query, within the limits; false: not given or too long. */
static bool range_params(const char *query, long long *from, long long *to)
{
    char from_s[16] = "", to_s[16] = "";
    query_param(query, "from", from_s, sizeof(from_s));
    query_param(query, "to", to_s, sizeof(to_s));
    *from = atoll(from_s);
    *to = atoll(to_s);
    return *from > 0 && *to > *from && *to - *from <= MAX_RANGE_S;
}

// ---- All values of a device ----

struct Collector : Walk {
    const char *metric, *labels; // "": all
    bool diagnostics;
    int denied;
    Picked *picked;
};

static void collect_metric(void *arg, const char *name, const char *labels, const char *, double,
                           espm_metric_kind_t kind)
{
    Collector &c = static_cast<Collector &>(*(Walk *)arg);
    if (!c.in || c.picked->count >= MAX_SERIES) return;
    if (c.metric[0] ? strcmp(name, c.metric) != 0 || strcmp(labels, c.labels) != 0
                    : (strncmp(name, "device.", 7) == 0) != c.diagnostics)
        return;
    if (!plain(name, 32, false) || !plain(labels, 48, true)) return;
    if (!series_visible(c, labels)) {
        c.denied++;
        return;
    }
    pick(*c.picked, name, labels, kind == ESPM_COUNTER);
}

static esp_err_t history(httpd_req_t *req)
{
    char query[512], device[64] = "", metric[32] = "", labels[48] = "", diag[4] = "";
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) query[0] = 0;
    query_param(query, "device", device, sizeof(device));
    query_param(query, "metric", metric, sizeof(metric));
    query_param(query, "labels", labels, sizeof(labels));
    query_param(query, "diagnostics", diag, sizeof(diag));
    long long from, to;
    if (!plain(device, sizeof(device), false) || !plain(metric, sizeof(metric), true) ||
        !plain(labels, sizeof(labels), true) || !range_params(query, &from, &to))
        return espm_send_error(req, 400, "device, from and to (unix seconds) needed");

    Picked *p = picked_new();
    if (!p) return espm_send_error(req, 500, "out of memory");
    // One series, else diagnostics (`device.*`) only when asked for, the others otherwise.
    Collector c = {{device, false, false, {}}, metric, labels, diag[0] == '1', 0, p};
    bool found = walk(c, collect_metric);
    picked_close(*p);

    esp_err_t res;
    if (!found) res = espm_send_error(req, 404, "unknown device");
    else if (!p->count && c.denied) res = espm_send_error(req, 403, "forbidden");
    else if (!p->count) {
        httpd_resp_set_type(req, "application/json");
        res = httpd_resp_send(req, EMPTY_ANSWER, sizeof(EMPTY_ANSWER) - 1);
    } else {
        Request r = {};
        if (build(r, device, *p, from, to, step_of(from, to, points_param(query)))) res = forward(req, r);
        else res = espm_send_error(req, 500, "history source not set up (URL, table)");
    }
    free(p);
    return res;
}
#endif

void espm_history_init()
{
#if ESPM_HTTP
    espm_route(HTTP_GET, "/api/v1/history/series", series, ESPM_ACCOUNT);
    espm_route(HTTP_GET, "/api/v1/history", history, ESPM_ACCOUNT);
#endif
}
