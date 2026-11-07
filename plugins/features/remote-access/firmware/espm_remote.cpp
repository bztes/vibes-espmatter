// espmatter studio – remote access: a WebSocket from the device to the app
// (`<app>/api/v1/devices/<id>/tunnel`, the device's API token as Bearer). The app sends HTTP
// requests for `<subdomain>.<device domain>` down it; they are answered by the device's own HTTP
// server over loopback, so routes, login and web interface work exactly as on the LAN.
//
// Wire format (protocol 1, see src/lib/server/tunnel/core.ts in the app):
//   app → device  text   {"t":"req","id":7,"m":"GET","p":"/api/v1/info","h":{…},"n":<body bytes>}
//                 binary 4-byte id (big endian) + body          (only when n > 0)
//   device → app  text   {"t":"res","id":7,"s":200,"h":{…}}
//                 binary 4-byte id + a chunk of the body        (any number)
//                 text   {"t":"end","id":7}   or   {"t":"err","id":7,"e":"…"}
#include "espm.h"
#include "espm_remote.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_websocket_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

static const char *TAG = "espm_remote";
static constexpr size_t MAX_BODY = 16 * 1024; // as the app's MAX_BODY
static constexpr size_t MAX_TEXT = 2048;      // a request's head: method, path, a few headers
static constexpr size_t CHUNK = 2048;         // response body per binary frame
static constexpr int QUEUE_LEN = 4;

/** A request from the app, waiting for the worker. */
struct Job {
    uint32_t id;
    cJSON *head;
    uint8_t *body;
    size_t body_len;
};

static esp_websocket_client_handle_t s_ws;
static QueueHandle_t s_jobs;
static char *s_uri;
static char *s_auth_header;

// The message being received (a frame can arrive in several events).
static uint8_t *s_rx;
static size_t s_rx_len, s_rx_cap;
static uint8_t s_rx_op;
// A request head whose body (the next binary frame) hasn't arrived yet.
static Job s_waiting;

// Status, for GET /api/v1/remote.
static bool s_connected;
static time_t s_since;
static unsigned s_requests, s_failures, s_connects;
static char s_error[64];

static void set_error(const char *msg)
{
    strlcpy(s_error, msg, sizeof(s_error));
}

static void send_text(cJSON *json)
{
    char *text = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!text) return;
    esp_websocket_client_send_text(s_ws, text, strlen(text), pdMS_TO_TICKS(10000));
    cJSON_free(text);
}

static void send_end(uint32_t id, const char *error)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "t", error ? "err" : "end");
    cJSON_AddNumberToObject(json, "id", id);
    if (error) cJSON_AddStringToObject(json, "e", error);
    send_text(json);
}

// ---------------------------------------------------------------------------------------------
// Answering a request from the device's own HTTP server
// ---------------------------------------------------------------------------------------------

/** Response headers passed back to the app (the rest is the app's business). */
static const char *const PASS_BACK[] = {
    "Content-Type", "Content-Encoding", "Cache-Control", "Location", "WWW-Authenticate",
    "Access-Control-Allow-Origin", "Access-Control-Allow-Headers", "Access-Control-Allow-Methods",
};

static esp_err_t on_http_event(esp_http_client_event_t *evt)
{
    if (evt->event_id != HTTP_EVENT_ON_HEADER) return ESP_OK;
    auto *headers = static_cast<cJSON *>(evt->user_data);
    for (const char *name : PASS_BACK)
        if (strcasecmp(evt->header_key, name) == 0 && !cJSON_GetObjectItem(headers, name))
            cJSON_AddStringToObject(headers, name, evt->header_value);
    return ESP_OK;
}

static esp_http_client_method_t method_of(const char *m)
{
    if (!strcmp(m, "POST")) return HTTP_METHOD_POST;
    if (!strcmp(m, "PUT")) return HTTP_METHOD_PUT;
    if (!strcmp(m, "DELETE")) return HTTP_METHOD_DELETE;
    if (!strcmp(m, "PATCH")) return HTTP_METHOD_PATCH;
    if (!strcmp(m, "HEAD")) return HTTP_METHOD_HEAD;
    if (!strcmp(m, "OPTIONS")) return HTTP_METHOD_OPTIONS;
    return HTTP_METHOD_GET;
}

static void answer(const Job &job)
{
    const char *method = cJSON_GetStringValue(cJSON_GetObjectItem(job.head, "m"));
    const char *path = cJSON_GetStringValue(cJSON_GetObjectItem(job.head, "p"));
    if (!method || !path || path[0] != '/') return send_end(job.id, "bad request");

    char url[600];
    if (snprintf(url, sizeof(url), "http://127.0.0.1%s", path) >= (int)sizeof(url))
        return send_end(job.id, "path too long");
    cJSON *headers = cJSON_CreateObject();
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.method = method_of(method);
    cfg.timeout_ms = 20000;
    cfg.buffer_size = CHUNK;
    cfg.disable_auto_redirect = true;
    cfg.event_handler = on_http_event;
    cfg.user_data = headers;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        cJSON_Delete(headers);
        return send_end(job.id, "out of memory");
    }
    cJSON *in = cJSON_GetObjectItem(job.head, "h");
    cJSON *h;
    cJSON_ArrayForEach(h, in)
        if (cJSON_IsString(h) && h->string) esp_http_client_set_header(client, h->string, h->valuestring);

    esp_err_t err = esp_http_client_open(client, job.body_len);
    if (err == ESP_OK && job.body_len &&
        esp_http_client_write(client, (const char *)job.body, job.body_len) != (int)job.body_len)
        err = ESP_FAIL;
    if (err == ESP_OK && esp_http_client_fetch_headers(client) < 0 && !esp_http_client_is_chunked_response(client))
        err = ESP_FAIL;
    if (err != ESP_OK) {
        cJSON_Delete(headers);
        esp_http_client_cleanup(client);
        s_failures++;
        return send_end(job.id, "the device's HTTP server didn't answer");
    }

    cJSON *res = cJSON_CreateObject();
    cJSON_AddStringToObject(res, "t", "res");
    cJSON_AddNumberToObject(res, "id", job.id);
    cJSON_AddNumberToObject(res, "s", esp_http_client_get_status_code(client));
    cJSON_AddItemToObject(res, "h", headers);
    send_text(res);

    auto *frame = static_cast<uint8_t *>(malloc(4 + CHUNK));
    const char *failed = frame ? nullptr : "out of memory";
    if (frame) {
        frame[0] = job.id >> 24, frame[1] = job.id >> 16, frame[2] = job.id >> 8, frame[3] = job.id;
        for (;;) {
            int n = esp_http_client_read(client, (char *)frame + 4, CHUNK);
            if (n < 0) {
                failed = "reading the answer failed";
                break;
            }
            if (n == 0) break;
            if (esp_websocket_client_send_bin(s_ws, (const char *)frame, 4 + n, pdMS_TO_TICKS(10000)) < 0) {
                failed = "sending to the app failed";
                break;
            }
        }
        free(frame);
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    if (failed) s_failures++;
    send_end(job.id, failed);
}

static void worker(void *)
{
    Job job;
    for (;;) {
        if (xQueueReceive(s_jobs, &job, portMAX_DELAY) != pdTRUE) continue;
        s_requests++;
        if (esp_websocket_client_is_connected(s_ws)) answer(job);
        cJSON_Delete(job.head);
        free(job.body);
    }
}

// ---------------------------------------------------------------------------------------------
// Receiving (in the WebSocket client's task: no blocking here)
// ---------------------------------------------------------------------------------------------

static void enqueue(Job &job)
{
    if (xQueueSend(s_jobs, &job, 0) != pdTRUE) {
        send_end(job.id, "busy");
        cJSON_Delete(job.head);
        free(job.body);
    }
    job = {};
}

static void drop_waiting()
{
    if (s_waiting.head) cJSON_Delete(s_waiting.head);
    s_waiting = {};
}

static void on_message(uint8_t op, const uint8_t *data, size_t len)
{
    if (op == 0x1) { // text: a request head
        cJSON *head = cJSON_ParseWithLength((const char *)data, len);
        if (!head) return;
        const char *t = cJSON_GetStringValue(cJSON_GetObjectItem(head, "t"));
        cJSON *id = cJSON_GetObjectItem(head, "id");
        if (!t || strcmp(t, "req") || !cJSON_IsNumber(id)) {
            cJSON_Delete(head);
            return;
        }
        drop_waiting();
        Job job = {(uint32_t)id->valuedouble, head, nullptr, 0};
        double n = cJSON_GetNumberValue(cJSON_GetObjectItem(head, "n"));
        if (n > MAX_BODY) {
            send_end(job.id, "body too large");
            cJSON_Delete(head);
        } else if (n > 0) {
            job.body_len = (size_t)n;
            s_waiting = job; // the body comes in the next binary frame
        } else
            enqueue(job);
    } else if (op == 0x2 && s_waiting.head && len >= 4) { // binary: the waiting request's body
        uint32_t id = (uint32_t)data[0] << 24 | (uint32_t)data[1] << 16 | (uint32_t)data[2] << 8 | data[3];
        if (id != s_waiting.id || len - 4 != s_waiting.body_len) return drop_waiting();
        s_waiting.body = static_cast<uint8_t *>(malloc(s_waiting.body_len));
        if (!s_waiting.body) {
            send_end(id, "out of memory");
            return drop_waiting();
        }
        memcpy(s_waiting.body, data + 4, s_waiting.body_len);
        enqueue(s_waiting);
    }
}

static void on_ws_event(void *, esp_event_base_t, int32_t event_id, void *event_data)
{
    auto *e = static_cast<esp_websocket_event_data_t *>(event_data);
    switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
        s_connected = true;
        s_since = time(nullptr);
        s_connects++;
        s_error[0] = 0;
        ESP_LOGI(TAG, "connected to the app");
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_CLOSED:
        if (s_connected) ESP_LOGW(TAG, "connection to the app lost");
        s_connected = false;
        s_rx_len = 0;
        drop_waiting();
        break;
    case WEBSOCKET_EVENT_ERROR:
        set_error(e && e->error_handle.esp_ws_handshake_status_code == 401 ? "the app refused the token"
                                                                             : "can't reach the app");
        break;
    case WEBSOCKET_EVENT_DATA: {
        if (!e || (e->op_code != 0x1 && e->op_code != 0x2 && e->op_code != 0x0)) break;
        // A message can come in several events: offset 0 starts it, it ends at payload_len.
        if (e->payload_offset == 0) {
            s_rx_len = 0;
            s_rx_op = e->op_code;
        }
        size_t total = e->payload_len > 0 ? (size_t)e->payload_len : (size_t)e->data_len;
        if (total > MAX_BODY + 4 || (s_rx_op == 0x1 && total > MAX_TEXT)) break; // dropped
        if (s_rx_cap < total) {
            auto *grown = static_cast<uint8_t *>(realloc(s_rx, total));
            if (!grown) break;
            s_rx = grown;
            s_rx_cap = total;
        }
        if (s_rx_len + e->data_len > s_rx_cap) break;
        memcpy(s_rx + s_rx_len, e->data_ptr, e->data_len);
        s_rx_len += e->data_len;
        if (s_rx_len >= total) {
            on_message(s_rx_op, s_rx, s_rx_len);
            s_rx_len = 0;
            // Keep a small buffer, give back a large one (a request body).
            if (s_rx_cap > MAX_TEXT) {
                free(s_rx);
                s_rx = nullptr;
                s_rx_cap = 0;
            }
        }
        break;
    }
    default:
        break;
    }
}

// ---------------------------------------------------------------------------------------------
// Status and start
// ---------------------------------------------------------------------------------------------

static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "enabled", s_ws != nullptr);
    cJSON_AddBoolToObject(json, "connected", s_connected);
    cJSON_AddNumberToObject(json, "since", s_connected ? (double)s_since : 0);
    cJSON_AddNumberToObject(json, "connects", s_connects);
    cJSON_AddNumberToObject(json, "requests", s_requests);
    cJSON_AddNumberToObject(json, "failures", s_failures);
    cJSON_AddStringToObject(json, "lastError", s_error);
    return espm_send_json(req, json);
}

void espm_remote_init()
{
    espm_route(HTTP_GET, "/api/v1/remote", status);
}

void espm_remote_start()
{
    if (s_ws) return;
    if (!ESPM_REMOTE_ON) {
        set_error("off for this device");
        return;
    }
    const char *app = ESPM_APP_URL;
    bool tls = strncmp(app, "https://", 8) == 0;
    if (!app[0] || (!tls && strncmp(app, "http://", 7) != 0)) {
        set_error("no app URL");
        ESP_LOGW(TAG, "no app URL – remote access off");
        return;
    }
    // http(s)://host[:port][/base] → ws(s)://host[:port][/base]/api/v1/devices/<id>/tunnel
    const char *rest = app + (tls ? 8 : 7);
    size_t rest_len = strlen(rest);
    while (rest_len && rest[rest_len - 1] == '/') rest_len--;
    asprintf(&s_uri, "%s://%.*s/api/v1/devices/%s/tunnel", tls ? "wss" : "ws", (int)rest_len, rest, ESPM_DEVICE_ID);
    asprintf(&s_auth_header, "Authorization: Bearer %s\r\n", ESPM_API_TOKEN);
    if (!s_uri || !s_auth_header) return;

    s_jobs = xQueueCreate(QUEUE_LEN, sizeof(Job));
    xTaskCreate(worker, "espm_remote", 6144, nullptr, 4, nullptr);

    esp_websocket_client_config_t cfg = {};
    cfg.uri = s_uri;
    cfg.headers = s_auth_header;
    cfg.buffer_size = CHUNK + 4;
    cfg.task_stack = 6144;
    cfg.reconnect_timeout_ms = 10000;
    cfg.network_timeout_ms = 15000;
    cfg.ping_interval_sec = 20;
    cfg.pingpong_timeout_sec = 60;
    if (tls) cfg.crt_bundle_attach = esp_crt_bundle_attach;
    s_ws = esp_websocket_client_init(&cfg);
    if (!s_ws) {
        set_error("out of memory");
        return;
    }
    esp_websocket_register_events(s_ws, WEBSOCKET_EVENT_ANY, on_ws_event, nullptr);
    esp_websocket_client_start(s_ws);
    ESP_LOGI(TAG, "connecting to %.*s", (int)(strstr(s_uri, "/api/v1/") - s_uri), s_uri);
}
