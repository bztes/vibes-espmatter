// espmatter studio – device configuration partition. See espm_cfg.h.
#include "espm_cfg.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <esp_log.h>
#include <esp_partition.h>
#include <nvs.h>
#include <nvs_flash.h>

static const char *TAG = "espm_cfg";
static const char *PARTITION = "espm_cfg";

struct Value {
    std::string ns, key, text;
    int64_t number;
    bool is_text;
};

static std::vector<Value> *s_values;

static const esp_partition_t *partition()
{
    return esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_NVS, PARTITION);
}

static void load(nvs_entry_info_t &info)
{
    nvs_handle_t h;
    if (nvs_open_from_partition(PARTITION, info.namespace_name, NVS_READONLY, &h) != ESP_OK) return;
    Value v{info.namespace_name, info.key, "", 0, false};
    switch (info.type) {
    case NVS_TYPE_STR: {
        size_t len = 0;
        if (nvs_get_str(h, info.key, nullptr, &len) == ESP_OK && len > 0) {
            std::vector<char> buf(len);
            if (nvs_get_str(h, info.key, buf.data(), &len) == ESP_OK) v.text = buf.data();
        }
        v.is_text = true;
        break;
    }
    case NVS_TYPE_U8: {
        uint8_t x = 0;
        nvs_get_u8(h, info.key, &x);
        v.number = x;
        break;
    }
    case NVS_TYPE_I32: {
        int32_t x = 0;
        nvs_get_i32(h, info.key, &x);
        v.number = x;
        break;
    }
    default:
        nvs_close(h);
        return;
    }
    nvs_close(h);
    s_values->push_back(std::move(v));
}

void espm_cfg_init(void)
{
    if (s_values) return;
    s_values = new std::vector<Value>();
    esp_err_t err = nvs_flash_init_partition(PARTITION);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No device configuration (%s)", esp_err_to_name(err));
        return;
    }
    nvs_iterator_t it = nullptr;
    for (err = nvs_entry_find(PARTITION, nullptr, NVS_TYPE_ANY, &it); err == ESP_OK; err = nvs_entry_next(&it)) {
        nvs_entry_info_t info;
        if (nvs_entry_info(it, &info) == ESP_OK) load(info);
    }
    nvs_release_iterator(it);
    if (s_values->empty())
        ESP_LOGW(TAG, "The device configuration is empty – flash the device from the app");
    else
        ESP_LOGI(TAG, "Device configuration: %u values", (unsigned)s_values->size());
}

bool espm_cfg_loaded(void)
{
    espm_cfg_init();
    return !s_values->empty();
}

static const Value *find(const char *ns, const char *key)
{
    espm_cfg_init();
    for (const auto &v : *s_values)
        if (v.ns == ns && v.key == key) return &v;
    return nullptr;
}

const char *espm_cfg_str(const char *ns, const char *key, const char *fallback)
{
    const Value *v = find(ns, key);
    return v && v->is_text ? v->text.c_str() : fallback;
}

int espm_cfg_int(const char *ns, const char *key, int fallback)
{
    const Value *v = find(ns, key);
    if (!v) return fallback;
    return v->is_text ? atoi(v->text.c_str()) : (int)v->number;
}

double espm_cfg_num(const char *ns, const char *key, double fallback)
{
    const Value *v = find(ns, key);
    if (!v) return fallback;
    return v->is_text ? strtod(v->text.c_str(), nullptr) : (double)v->number;
}

bool espm_cfg_bool(const char *ns, const char *key, bool fallback)
{
    const Value *v = find(ns, key);
    if (!v) return fallback;
    return v->is_text ? (v->text == "1" || v->text == "true") : v->number != 0;
}

const char *espm_hostname(void)
{
    static char host[33];
    if (host[0]) return host;
    const char *set = espm_cfg_str("espm", "host", "");
    const char *name = set[0] ? set : espm_cfg_str("espm", "name", "espmatter");
    size_t n = 0;
    bool dash = false;
    for (const char *p = name; *p && n < sizeof(host) - 1; p++) {
        if (isalnum((unsigned char)*p)) {
            if (dash && n) host[n++] = '-';
            if (n < sizeof(host) - 1) host[n++] = (char)tolower((unsigned char)*p);
            dash = false;
        } else dash = true;
    }
    host[n] = 0;
    if (!n) strlcpy(host, "espmatter", sizeof(host));
    return host;
}

// ---------------------------------------------------------------------------------------------
// The app reads and replaces the configuration (GET/PUT /api/v1/config), with the API token only.
// ---------------------------------------------------------------------------------------------
#include "espm.h"

#if ESPM_HTTP
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

static bool app_caller(httpd_req_t *req)
{
    if (espm_caller_user() == -1) return true;
    espm_send_error(req, 403, "only the app reads and writes the configuration");
    return false;
}

/** `{"values": [{"ns", "key", "value"}]}`: what the device runs (loaded at boot). */
static esp_err_t get_config(httpd_req_t *req)
{
    if (!app_caller(req)) return ESP_OK;
    espm_cfg_init();
    cJSON *json = cJSON_CreateObject();
    cJSON *list = cJSON_AddArrayToObject(json, "values");
    for (const auto &v : *s_values) {
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "ns", v.ns.c_str());
        cJSON_AddStringToObject(item, "key", v.key.c_str());
        if (v.is_text) cJSON_AddStringToObject(item, "value", v.text.c_str());
        else cJSON_AddNumberToObject(item, "value", (double)v.number);
        cJSON_AddItemToArray(list, item);
    }
    return espm_send_json(req, json);
}

/** One NVS handle per run of a namespace, committed when the namespace changes. */
struct Writer {
    std::string ns;
    nvs_handle_t h = 0;
    bool open = false;

    esp_err_t close()
    {
        if (!open) return ESP_OK;
        esp_err_t err = nvs_commit(h);
        nvs_close(h);
        open = false;
        return err;
    }

    esp_err_t handle(const char *name)
    {
        if (open && ns == name) return ESP_OK;
        esp_err_t err = close();
        if (err == ESP_OK) err = nvs_open_from_partition(PARTITION, name, NVS_READWRITE, &h);
        if (err == ESP_OK) open = true, ns = name;
        return err;
    }
};

static esp_err_t set_value(Writer &w, cJSON *item)
{
    cJSON *ns = cJSON_GetObjectItem(item, "ns");
    cJSON *key = cJSON_GetObjectItem(item, "key");
    cJSON *type = cJSON_GetObjectItem(item, "type");
    cJSON *value = cJSON_GetObjectItem(item, "value");
    if (!cJSON_IsString(ns) || !cJSON_IsString(key) || !cJSON_IsString(type) || !value)
        return ESP_ERR_INVALID_ARG;
    esp_err_t err = w.handle(ns->valuestring);
    if (err != ESP_OK) return err;
    nvs_handle_t h = w.h;
    const char *t = type->valuestring;
    if (!strcmp(t, "bool")) err = nvs_set_u8(h, key->valuestring, cJSON_IsTrue(value) ? 1 : 0);
    else if (!strcmp(t, "int")) err = nvs_set_i32(h, key->valuestring, (int32_t)cJSON_GetNumberValue(value));
    else if (cJSON_IsString(value)) err = nvs_set_str(h, key->valuestring, value->valuestring);
    else if (cJSON_IsNumber(value)) {
        // Numbers are stored as text, as the app writes them.
        char text[32];
        snprintf(text, sizeof(text), "%.10g", value->valuedouble);
        err = nvs_set_str(h, key->valuestring, text);
    } else err = ESP_ERR_INVALID_ARG;
    return err;
}

static void restart_task(void *)
{
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
}

/**
 * Replace the whole configuration with `{"values": [{"ns", "key", "type", "value"}]}` (types as
 * in cfg.ts), then restart: values are read at boot.
 */
static esp_err_t put_config(httpd_req_t *req)
{
    if (!app_caller(req)) return ESP_OK;
    cJSON *body = espm_read_json(req, 12 * 1024);
    if (!body) return ESP_FAIL;
    cJSON *list = cJSON_GetObjectItem(body, "values");
    if (!cJSON_IsArray(list) || !cJSON_GetArraySize(list)) {
        cJSON_Delete(body);
        return espm_send_error(req, 400, "values required");
    }
    const esp_partition_t *p = partition();
    esp_err_t err = p ? ESP_OK : ESP_ERR_NOT_FOUND;
    if (err == ESP_OK) {
        nvs_flash_deinit_partition(PARTITION);
        err = esp_partition_erase_range(p, 0, p->size);
    }
    if (err == ESP_OK) err = nvs_flash_init_partition(PARTITION);
    Writer w;
    cJSON *item;
    cJSON_ArrayForEach(item, list)
    {
        if (err != ESP_OK) break;
        err = set_value(w, item);
    }
    esp_err_t closed = w.close();
    if (err == ESP_OK) err = closed;
    cJSON_Delete(body);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Writing the configuration failed: %s", esp_err_to_name(err));
        return espm_send_error(req, 500, esp_err_to_name(err));
    }
    ESP_LOGI(TAG, "New device configuration written – restarting");
    espm_send_ok(req);
    xTaskCreate(restart_task, "restart", 2048, nullptr, 5, nullptr);
    return ESP_OK;
}

struct CfgRoutes {
    CfgRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/config", get_config);
        espm_route(HTTP_PUT, "/api/v1/config", put_config);
    }
};
static CfgRoutes s_routes;
#endif
