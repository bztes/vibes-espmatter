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
        ESP_LOGW(TAG, "The device configuration is empty – flash the device from the app (or write its config.bin)");
    else
        ESP_LOGI(TAG, "Device configuration %s: %u values", espm_cfg_str("espm", "rev", "?"),
                 (unsigned)s_values->size());
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

size_t espm_cfg_size(void)
{
    const esp_partition_t *p = partition();
    return p ? p->size : 0;
}

esp_err_t espm_cfg_write(const uint8_t *image, size_t len)
{
    const esp_partition_t *p = partition();
    if (!p) return ESP_ERR_NOT_FOUND;
    if (len != p->size) return ESP_ERR_INVALID_SIZE;
    // First page: active or full (0xfffffffe / 0xfffffffc), as the app writes it.
    uint32_t state;
    memcpy(&state, image, sizeof(state));
    if (state != 0xfffffffe && state != 0xfffffffc) return ESP_ERR_INVALID_ARG;
    nvs_flash_deinit_partition(PARTITION);
    esp_err_t err = esp_partition_erase_range(p, 0, p->size);
    if (err == ESP_OK) err = esp_partition_write(p, 0, image, len);
    ESP_LOGI(TAG, "New device configuration written: %s", esp_err_to_name(err));
    return err;
}
