// espmatter studio – peripheral "climate-sensor": SHT4x/SHT3x on I²C as Matter temperature + humidity sensor.
#include "espm.h"
#include "espm_climate.h"

#include <math.h>
#include <string>
#include <vector>
#include <driver/i2c_master.h>
#include <esp_log.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

using namespace esp_matter;
using namespace chip::app::Clusters;

static const char *TAG = "espm_climate";

struct Bus {
    int sda, scl;
    i2c_master_bus_handle_t handle;
};
static std::vector<Bus> s_buses;

struct Sensor {
    espm_climate_cfg_t cfg;
    i2c_master_dev_handle_t dev;
    uint16_t ep_temp, ep_hum;
    float temperature, humidity;
    bool ok;
    int64_t at_us;
    std::string path;
};

/** Sensors on the same pins share one bus. */
static i2c_master_bus_handle_t bus_for(int sda, int scl)
{
    for (auto &b : s_buses)
        if (b.sda == sda && b.scl == scl) return b.handle;
    i2c_master_bus_config_t cfg = {};
    cfg.i2c_port = -1;
    cfg.sda_io_num = (gpio_num_t)sda;
    cfg.scl_io_num = (gpio_num_t)scl;
    cfg.clk_source = I2C_CLK_SRC_DEFAULT;
    cfg.glitch_ignore_cnt = 7;
    cfg.flags.enable_internal_pullup = true;
    i2c_master_bus_handle_t handle = nullptr;
    if (i2c_new_master_bus(&cfg, &handle) != ESP_OK) ESP_LOGE(TAG, "I2C bus on %d/%d failed", sda, scl);
    s_buses.push_back({sda, scl, handle});
    return handle;
}

static uint8_t crc8(const uint8_t *data)
{
    uint8_t crc = 0xff;
    for (int i = 0; i < 2; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) crc = crc & 0x80 ? (crc << 1) ^ 0x31 : crc << 1;
    }
    return crc;
}

static bool measure(Sensor *s)
{
    uint8_t rx[6];
    if (s->cfg.model == ESPM_SHT4X) {
        uint8_t cmd = 0xFD; // high precision
        if (i2c_master_transmit(s->dev, &cmd, 1, 100) != ESP_OK) return false;
        vTaskDelay(pdMS_TO_TICKS(10));
    } else {
        uint8_t cmd[2] = {0x24, 0x00}; // single shot, high repeatability, no clock stretching
        if (i2c_master_transmit(s->dev, cmd, 2, 100) != ESP_OK) return false;
        vTaskDelay(pdMS_TO_TICKS(16));
    }
    if (i2c_master_receive(s->dev, rx, 6, 100) != ESP_OK) return false;
    if (crc8(rx) != rx[2] || crc8(rx + 3) != rx[5]) return false;
    uint16_t t = (rx[0] << 8) | rx[1], h = (rx[3] << 8) | rx[4];
    s->temperature = -45 + 175.0f * t / 65535 + s->cfg.offset;
    s->humidity = s->cfg.model == ESPM_SHT4X ? -6 + 125.0f * h / 65535 : 100.0f * h / 65535;
    s->humidity = fminf(100, fmaxf(0, s->humidity));
    return true;
}

static void task(void *arg)
{
    Sensor *s = (Sensor *)arg;
    char labels[48];
    snprintf(labels, sizeof(labels), "sensor=%s", s->cfg.uid);
    for (;;) {
        s->ok = measure(s);
        if (s->ok) {
            s->at_us = esp_timer_get_time();
            espm_attr_update(s->ep_temp, TemperatureMeasurement::Id, TemperatureMeasurement::Attributes::MeasuredValue::Id,
                             esp_matter_nullable_int16((int16_t)lroundf(s->temperature * 100)));
            espm_attr_update(s->ep_hum, RelativeHumidityMeasurement::Id,
                             RelativeHumidityMeasurement::Attributes::MeasuredValue::Id,
                             esp_matter_nullable_uint16((uint16_t)lroundf(s->humidity * 100)));
            espm_metric_set("temperature", labels, "Cel", s->temperature);
            espm_metric_set("humidity", labels, "%", s->humidity);
        } else {
            ESP_LOGW(TAG, "%s: no answer from 0x%02x", s->cfg.name, s->cfg.address);
        }
        vTaskDelay(pdMS_TO_TICKS(s->cfg.interval_s * 1000));
    }
}

#if ESPM_HTTP
static esp_err_t get_state(httpd_req_t *req)
{
    Sensor *s = (Sensor *)espm_route_ctx(req);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "uid", s->cfg.uid);
    cJSON_AddStringToObject(json, "peripheral", "climate-sensor");
    cJSON_AddStringToObject(json, "name", s->cfg.name);
    cJSON_AddBoolToObject(json, "ok", s->ok);
    if (s->at_us) {
        cJSON_AddNumberToObject(json, "temperature", roundf(s->temperature * 10) / 10);
        cJSON_AddNumberToObject(json, "humidity", roundf(s->humidity * 10) / 10);
        cJSON_AddNumberToObject(json, "age", (esp_timer_get_time() - s->at_us) / 1000000);
    }
    return espm_send_json(req, json);
}
#endif

void espm_climate_add(const espm_climate_cfg_t &cfg)
{
    Sensor *s = new Sensor{cfg, nullptr, 0, 0, 0, 0, false, 0, std::string("/api/v1/peripherals/") + cfg.uid};
    i2c_device_config_t dev = {};
    dev.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    dev.device_address = cfg.address;
    dev.scl_speed_hz = 100000;
    i2c_master_bus_handle_t bus = bus_for(cfg.sda, cfg.scl);
    if (bus) i2c_master_bus_add_device(bus, &dev, &s->dev);

    temperature_sensor::config_t t;
    s->ep_temp = endpoint::get_id(temperature_sensor::create(espm_node(), &t, ENDPOINT_FLAG_NONE, s));
    humidity_sensor::config_t h;
    s->ep_hum = endpoint::get_id(humidity_sensor::create(espm_node(), &h, ENDPOINT_FLAG_NONE, s));

    if (s->dev) xTaskCreate(task, "espm_climate", 3072, s, 3, nullptr);
#if ESPM_HTTP
    espm_route(HTTP_GET, s->path.c_str(), get_state, ESPM_ADMIN, s);
#endif
    ESP_LOGI(TAG, "%s: endpoints %d (temperature), %d (humidity)", cfg.name, s->ep_temp, s->ep_hum);
}
