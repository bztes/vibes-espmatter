// espmatter studio – peripheral "contact-sensor": a contact on a GPIO as Matter Contact Sensor (BooleanState).
#include "espm.h"
#include "espm_contact.h"

#include <string>
#include <vector>
#include <driver/gpio.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

using namespace esp_matter;
using namespace chip::app::Clusters;

struct Contact {
    espm_contact_cfg_t cfg;
    uint16_t endpoint;
    bool closed;
    int raw;
    int64_t raw_since_ms, changed_ms;
    unsigned changes;
    std::string path;
};
static std::vector<Contact *> s_contacts;

static bool read(Contact *c) { return (gpio_get_level((gpio_num_t)c->cfg.gpio) == 0) ^ c->cfg.invert; }

static void task(void *)
{
    for (;;) {
        int64_t now = esp_timer_get_time() / 1000;
        for (auto *c : s_contacts) {
            int raw = read(c);
            if (raw != c->raw) {
                c->raw = raw;
                c->raw_since_ms = now;
            } else if (raw != c->closed && now - c->raw_since_ms >= c->cfg.debounce_ms) {
                c->closed = raw;
                c->changes++;
                c->changed_ms = now;
                espm_attr_update(c->endpoint, BooleanState::Id, BooleanState::Attributes::StateValue::Id, esp_matter_bool(c->closed));
                espm_metric_set("contact_closed", c->path.c_str() + 15, "1", c->closed);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

#if ESPM_HTTP
static esp_err_t get_state(httpd_req_t *req)
{
    Contact *c = (Contact *)espm_route_ctx(req);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "uid", c->cfg.uid);
    cJSON_AddStringToObject(json, "peripheral", "contact-sensor");
    cJSON_AddStringToObject(json, "name", c->cfg.name);
    cJSON_AddBoolToObject(json, "closed", c->closed);
    cJSON_AddNumberToObject(json, "changes", c->changes);
    cJSON_AddNumberToObject(json, "lastChange", (esp_timer_get_time() / 1000 - c->changed_ms) / 1000);
    return espm_send_json(req, json);
}
#endif

void espm_contact_add(const espm_contact_cfg_t &cfg)
{
    gpio_reset_pin((gpio_num_t)cfg.gpio);
    gpio_set_direction((gpio_num_t)cfg.gpio, GPIO_MODE_INPUT);
    gpio_set_pull_mode((gpio_num_t)cfg.gpio, GPIO_PULLUP_ONLY);
    Contact *c = new Contact{cfg, 0, false, 0, 0, 0, 0, std::string("/api/v1/peripherals/") + cfg.uid};
    c->closed = c->raw = read(c);

    contact_sensor::config_t config;
    config.boolean_state.state_value = c->closed;
    c->endpoint = endpoint::get_id(contact_sensor::create(espm_node(), &config, ENDPOINT_FLAG_NONE, c));
    if (s_contacts.empty()) xTaskCreate(task, "espm_contact", 3072, nullptr, 4, nullptr);
    s_contacts.push_back(c);
#if ESPM_HTTP
    espm_route(HTTP_GET, c->path.c_str(), get_state, ESPM_ADMIN, c);
#endif
}
