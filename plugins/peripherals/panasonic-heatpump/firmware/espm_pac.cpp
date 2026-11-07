// espmatter studio – peripheral "panasonic-heatpump": Panasonic indoor unit on CN-CNT (9600 8E1) as a
// Matter Room Air Conditioner. The unit is polled; a command is the last polled state with the
// changed bytes. Protocol details from esphome-panasonic-ac (DomiStyle, MIT).
#include "espm.h"
#include "espm_pac.h"

#include <math.h>
#include <string.h>
#include <driver/uart.h>
#include <esp_log.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

using namespace esp_matter;
using namespace chip::app::Clusters;

static const char *TAG = "espm_pac";
#define PAC_UART UART_NUM_1
static const uint8_t POLL_HEADER = 0x70, CTRL_HEADER = 0xF0;

enum Mode : uint8_t { M_AUTO, M_COOL, M_HEAT, M_DRY, M_FAN };
static const char *MODE_NAMES[] = {"auto", "cool", "heat", "dry", "fan"};
static const uint8_t MODE_CODES[] = {0x0, 0x3, 0x4, 0x2, 0x6};
/** Matter Thermostat SystemMode for each mode. */
static const uint8_t MODE_MATTER[] = {1, 3, 4, 8, 7};

struct State {
    bool valid, power;
    Mode mode;
    uint8_t target_x2; // 0.5 °C steps
    uint8_t fan;       // 0 auto, 1–5
    int8_t inside, outside;
};
static State s_state = {false, false, M_HEAT, 42, 0, -128, -128};
static uint8_t s_data[10];
static int64_t s_last_rx;
static uint16_t s_ep;

/** Pending change from Matter or REST, sent by the UART task. */
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
static State s_want;
static bool s_dirty;

static uint8_t checksum(const uint8_t *d, size_t n)
{
    uint8_t s = 0;
    for (size_t i = 0; i < n; i++) s += d[i];
    return -s;
}

static void send(uint8_t header, const uint8_t *payload)
{
    uint8_t p[13] = {header, 10};
    memcpy(p + 2, payload, 10);
    p[12] = checksum(p, 12);
    uart_write_bytes(PAC_UART, p, sizeof(p));
}

static void publish()
{
    State s = s_state;
    espm_attr_update(s_ep, OnOff::Id, OnOff::Attributes::OnOff::Id, esp_matter_bool(s.power));
    espm_attr_update(s_ep, Thermostat::Id, Thermostat::Attributes::SystemMode::Id,
                     esp_matter_enum8(s.power ? MODE_MATTER[s.mode] : 0));
    int16_t target = s.target_x2 * 50;
    espm_attr_update(s_ep, Thermostat::Id, Thermostat::Attributes::OccupiedHeatingSetpoint::Id, esp_matter_int16(target));
    espm_attr_update(s_ep, Thermostat::Id, Thermostat::Attributes::OccupiedCoolingSetpoint::Id, esp_matter_int16(target));
    if (s.inside != -128) {
        espm_attr_update(s_ep, Thermostat::Id, Thermostat::Attributes::LocalTemperature::Id, esp_matter_nullable_int16(s.inside * 100));
        espm_metric_set("temperature", "sensor=" ESPM_PAC_UID ",side=inside", "Cel", s.inside);
    }
    if (s.outside != -128) {
        espm_attr_update(s_ep, Thermostat::Id, Thermostat::Attributes::OutdoorTemperature::Id, esp_matter_nullable_int16(s.outside * 100));
        espm_metric_set("temperature", "sensor=" ESPM_PAC_UID ",side=outside", "Cel", s.outside);
    }
    espm_attr_update(s_ep, FanControl::Id, FanControl::Attributes::FanMode::Id, esp_matter_enum8(s.fan == 0 ? 5 : s.fan <= 2 ? 1 : s.fan <= 4 ? 2 : 3));
    espm_metric_set("heatpump_power", "sensor=" ESPM_PAC_UID, "1", s.power);
}

static void parse(const uint8_t *rx, size_t len)
{
    if (len < 12 || rx[0] != POLL_HEADER || rx[1] != len - 3 || checksum(rx, len - 1) != rx[len - 1]) return;
    s_last_rx = esp_timer_get_time();
    memcpy(s_data, rx + 2, 10);
    const uint8_t *d = s_data;
    s_state.valid = true;
    s_state.power = (d[0] & 0x0F) != 0;
    for (int m = 0; m < 5; m++)
        if (MODE_CODES[m] == d[0] >> 4) s_state.mode = (Mode)m;
    s_state.target_x2 = d[1];
    s_state.fan = d[3] == 0xA0 ? 0 : (d[3] >= 0x30 && d[3] <= 0x70 ? (d[3] >> 4) - 2 : s_state.fan);
    auto temp = [&](size_t i) -> int8_t { return i < len && rx[i] != 0x80 ? (int8_t)rx[i] : -128; };
    s_state.inside = temp(18);
    s_state.outside = temp(19);
    portENTER_CRITICAL(&s_lock);
    bool dirty = s_dirty;
    portEXIT_CRITICAL(&s_lock);
    if (!dirty) publish();
}

static void apply_pending()
{
    portENTER_CRITICAL(&s_lock);
    if (!s_dirty || !s_state.valid) {
        portEXIT_CRITICAL(&s_lock);
        return;
    }
    State w = s_want;
    s_dirty = false;
    portEXIT_CRITICAL(&s_lock);
    uint8_t cmd[10];
    memcpy(cmd, s_data, 10);
    cmd[0] = (MODE_CODES[w.mode] << 4) | (w.power ? 0x04 : 0x00);
    cmd[1] = w.target_x2;
    cmd[3] = w.fan == 0 ? 0xA0 : (w.fan + 2) << 4;
    send(CTRL_HEADER, cmd);
    s_state.power = w.power;
    s_state.mode = w.mode;
    s_state.target_x2 = w.target_x2;
    s_state.fan = w.fan;
}

/** Start from what the unit reported and change some fields. */
template <typename F> static void change(F fn)
{
    portENTER_CRITICAL(&s_lock);
    if (!s_dirty) s_want = s_state;
    fn(s_want);
    s_dirty = true;
    portEXIT_CRITICAL(&s_lock);
}

static void task(void *)
{
    static const uint8_t poll[10] = {};
    uint8_t rx[64];
    int64_t last_poll = 0;
    for (;;) {
        int64_t now = esp_timer_get_time() / 1000;
        if (now - last_poll >= ESPM_PAC_POLL_S * 1000) {
            send(POLL_HEADER, poll);
            last_poll = now;
        }
        // A packet ends when the line is quiet for 20 ms.
        int n = uart_read_bytes(PAC_UART, rx, sizeof(rx), pdMS_TO_TICKS(20));
        if (n > 0) parse(rx, n);
        apply_pending();
        if (s_state.valid && esp_timer_get_time() - s_last_rx > 30000000) s_state.valid = false;
    }
}

static esp_err_t on_attr(uint16_t, uint32_t cluster, uint32_t attribute, esp_matter_attr_val_t *val, void *)
{
    if (cluster == OnOff::Id && attribute == OnOff::Attributes::OnOff::Id)
        change([&](State &w) { w.power = val->val.b; });
    else if (cluster == Thermostat::Id && attribute == Thermostat::Attributes::SystemMode::Id) {
        uint8_t m = val->val.u8;
        change([&](State &w) {
            w.power = m != 0;
            for (int i = 0; i < 5; i++)
                if (MODE_MATTER[i] == m) w.mode = (Mode)i;
        });
    } else if (cluster == Thermostat::Id && (attribute == Thermostat::Attributes::OccupiedHeatingSetpoint::Id ||
                                             attribute == Thermostat::Attributes::OccupiedCoolingSetpoint::Id)) {
        int x2 = (int)lroundf(val->val.i16 / 50.0f);
        change([&](State &w) { w.target_x2 = x2 < 32 ? 32 : x2 > 60 ? 60 : x2; });
    } else if (cluster == FanControl::Id && attribute == FanControl::Attributes::FanMode::Id) {
        static const uint8_t fan_of[] = {0, 1, 3, 5, 5, 0, 0};
        uint8_t m = val->val.u8;
        change([&](State &w) { w.fan = m < 7 ? fan_of[m] : 0; });
    }
    return ESP_OK;
}

#if ESPM_HTTP
static esp_err_t get_state(httpd_req_t *req)
{
    State s = s_state;
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "uid", ESPM_PAC_UID);
    cJSON_AddStringToObject(json, "peripheral", "panasonic-heatpump");
    cJSON_AddBoolToObject(json, "online", s.valid);
    cJSON_AddBoolToObject(json, "power", s.power);
    cJSON_AddStringToObject(json, "mode", MODE_NAMES[s.mode]);
    cJSON_AddNumberToObject(json, "target", s.target_x2 / 2.0);
    if (s.fan) cJSON_AddNumberToObject(json, "fan", s.fan);
    else cJSON_AddStringToObject(json, "fan", "auto");
    if (s.inside != -128) cJSON_AddNumberToObject(json, "inside", s.inside);
    if (s.outside != -128) cJSON_AddNumberToObject(json, "outside", s.outside);
    return espm_send_json(req, json);
}

static esp_err_t post_state(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *power = cJSON_GetObjectItem(body, "power"), *mode = cJSON_GetObjectItem(body, "mode");
    cJSON *target = cJSON_GetObjectItem(body, "target"), *fan = cJSON_GetObjectItem(body, "fan");
    change([&](State &w) {
        if (cJSON_IsBool(power)) w.power = cJSON_IsTrue(power);
        if (cJSON_IsString(mode))
            for (int i = 0; i < 5; i++)
                if (!strcmp(mode->valuestring, MODE_NAMES[i])) w.mode = (Mode)i;
        if (cJSON_IsNumber(target)) {
            int x2 = (int)lround(target->valuedouble * 2);
            w.target_x2 = x2 < 32 ? 32 : x2 > 60 ? 60 : x2;
        }
        if (cJSON_IsNumber(fan) && fan->valuedouble >= 1 && fan->valuedouble <= 5) w.fan = (uint8_t)fan->valuedouble;
        else if (cJSON_IsString(fan)) w.fan = 0;
    });
    cJSON_Delete(body);
    return espm_send_ok(req);
}
#endif

void espm_pac_init()
{
    endpoint::room_air_conditioner::config_t config;
    config.on_off.on_off = false;
    endpoint_t *ep = endpoint::room_air_conditioner::create(espm_node(), &config, ENDPOINT_FLAG_NONE, nullptr);
    s_ep = endpoint::get_id(ep);
    cluster::fan_control::config_t fan;
    cluster::fan_control::create(ep, &fan, CLUSTER_FLAG_SERVER);
    // Optional in the Thermostat cluster – the hub follows it like every other value.
    cluster::thermostat::attribute::create_outdoor_temperature(cluster::get(ep, Thermostat::Id), nullable<int16_t>());
    espm_on_attribute(s_ep, on_attr, nullptr);
#if ESPM_HTTP
    espm_route(HTTP_GET, "/api/v1/peripherals/" ESPM_PAC_UID, get_state);
    espm_route(HTTP_POST, "/api/v1/peripherals/" ESPM_PAC_UID, post_state);
#endif
}

void espm_pac_start()
{
    uart_config_t uart = {};
    uart.baud_rate = 9600;
    uart.data_bits = UART_DATA_8_BITS;
    uart.parity = UART_PARITY_EVEN;
    uart.stop_bits = UART_STOP_BITS_1;
    uart.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uart.source_clk = UART_SCLK_DEFAULT;
    uart_driver_install(PAC_UART, 256, 0, 0, nullptr, 0);
    uart_param_config(PAC_UART, &uart);
    uart_set_pin(PAC_UART, ESPM_PAC_TX, ESPM_PAC_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    xTaskCreate(task, "espm_pac", 4096, nullptr, 4, nullptr);
    ESP_LOGI(TAG, "CN-CNT on RX %d / TX %d", ESPM_PAC_RX, ESPM_PAC_TX);
}
