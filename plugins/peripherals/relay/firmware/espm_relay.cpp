// espmatter studio – peripheral "relay": Matter On/Off Plug-in Unit on a GPIO, optional button.
#include "espm.h"
#include "espm_relay.h"

#include <string>
#include <vector>
#include <driver/gpio.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

using namespace esp_matter;
using namespace chip::app::Clusters;

static const char *TAG = "espm_relay";

struct Relay {
    espm_relay_cfg_t cfg;
    uint16_t endpoint;
    bool on;
    std::string path;
};
static std::vector<Relay *> s_relays;
static bool s_button_task;

static void drive(Relay *r, bool on)
{
    r->on = on;
    gpio_set_level((gpio_num_t)r->cfg.gpio, on ^ r->cfg.active_low);
}

static esp_err_t on_attr(uint16_t, uint32_t cluster, uint32_t attribute, esp_matter_attr_val_t *val, void *ctx)
{
    if (cluster == OnOff::Id && attribute == OnOff::Attributes::OnOff::Id) drive((Relay *)ctx, val->val.b);
    return ESP_OK;
}

static void set(Relay *r, bool on)
{
    drive(r, on);
    espm_attr_update(r->endpoint, OnOff::Id, OnOff::Attributes::OnOff::Id, esp_matter_bool(on));
}

static void button_task(void *)
{
    std::vector<int> last(s_relays.size(), 1);
    for (;;) {
        for (size_t i = 0; i < s_relays.size(); i++) {
            Relay *r = s_relays[i];
            if (r->cfg.button < 0) continue;
            int level = gpio_get_level((gpio_num_t)r->cfg.button);
            if (last[i] == 1 && level == 0) set(r, !r->on);
            last[i] = level;
        }
        vTaskDelay(pdMS_TO_TICKS(40));
    }
}

#if ESPM_HTTP
static esp_err_t get_state(httpd_req_t *req)
{
    Relay *r = (Relay *)espm_route_ctx(req);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "uid", r->cfg.uid);
    cJSON_AddStringToObject(json, "peripheral", "relay");
    cJSON_AddStringToObject(json, "name", r->cfg.name);
    cJSON_AddBoolToObject(json, "on", r->on);
    cJSON_AddNumberToObject(json, "endpoint", r->endpoint);
    return espm_send_json(req, json);
}

static esp_err_t post_state(httpd_req_t *req)
{
    Relay *r = (Relay *)espm_route_ctx(req);
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *on = cJSON_GetObjectItem(body, "on");
    if (cJSON_IsTrue(cJSON_GetObjectItem(body, "toggle"))) set(r, !r->on);
    else if (cJSON_IsBool(on)) set(r, cJSON_IsTrue(on));
    cJSON_Delete(body);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "on", r->on);
    return espm_send_json(req, json);
}
#endif

void espm_relay_add(const espm_relay_cfg_t &cfg)
{
    Relay *r = new Relay{cfg, 0, false, std::string("/api/v1/peripherals/") + cfg.uid};
    gpio_reset_pin((gpio_num_t)cfg.gpio);
    gpio_set_direction((gpio_num_t)cfg.gpio, GPIO_MODE_OUTPUT);
    drive(r, cfg.startup == 1);

    on_off_plugin_unit::config_t config;
    config.on_off.on_off = cfg.startup == 1;
    if (cfg.startup != 2) config.on_off.lighting.start_up_on_off = cfg.startup;
    endpoint_t *ep = on_off_plugin_unit::create(espm_node(), &config, ENDPOINT_FLAG_NONE, r);
    r->endpoint = endpoint::get_id(ep);
    espm_on_attribute(r->endpoint, on_attr, r);

    if (cfg.button >= 0) {
        gpio_reset_pin((gpio_num_t)cfg.button);
        gpio_set_direction((gpio_num_t)cfg.button, GPIO_MODE_INPUT);
        gpio_set_pull_mode((gpio_num_t)cfg.button, GPIO_PULLUP_ONLY);
    }
    s_relays.push_back(r);
    if (cfg.button >= 0 && !s_button_task) {
        s_button_task = true;
        xTaskCreate(button_task, "espm_relay_btn", 3072, nullptr, 4, nullptr);
    }
#if ESPM_HTTP
    espm_route(HTTP_GET, r->path.c_str(), get_state, ESPM_ADMIN, r);
    espm_route(HTTP_POST, r->path.c_str(), post_state, ESPM_ADMIN, r);
#endif
    ESP_LOGI(TAG, "%s on GPIO%d, endpoint %d", cfg.name, cfg.gpio, r->endpoint);
}
