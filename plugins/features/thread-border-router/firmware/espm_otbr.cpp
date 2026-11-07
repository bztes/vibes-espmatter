// espmatter studio – OpenThread border router on the main board, RCP over UART (Spinel).
// Based on esp-idf examples/openthread/ot_br.
#include "espm.h"
#include "espm_otbr.h"

#include <string.h>
#include <driver/uart.h>
#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <esp_openthread.h>
#include <esp_openthread_border_router.h>
#include <esp_openthread_lock.h>
#include <esp_openthread_netif_glue.h>
#include <esp_openthread_spinel.h>
#include <esp_vfs_eventfd.h>
#include <mdns.h>
#include <openthread/dataset.h>
#include <openthread/dataset_ftd.h>
#include <openthread/thread.h>
#include <openthread/thread_ftd.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

static const char *TAG = "espm_otbr";
/** The radio: still starting (waiting for its update check, then connecting), answering, not, or being updated. */
enum rcp_state_t { RCP_STARTING, RCP_OK, RCP_FAILED, RCP_UPDATING };
static volatile rcp_state_t s_rcp = RCP_STARTING;
/** Held by whoever drives the radio's UART: this plugin, or the hub flashing the radio (release/reclaim). */
static SemaphoreHandle_t s_wires;
/** OpenThread is up (it then owns the UART, except between release and reclaim). */
static bool s_ot_running;

static void form_network(otInstance *ot, int channel)
{
    otOperationalDataset ds;
    otDatasetCreateNewNetwork(ot, &ds);
    if (channel >= 11 && channel <= 26) ds.mChannel = channel;
    otNetworkName name;
    strlcpy(name.m8, ESPM_OTBR_NETWORK_NAME, sizeof(name.m8));
    ds.mNetworkName = name;
    ds.mComponents.mIsNetworkNamePresent = true;
    otDatasetSetActive(ot, &ds);
    otIp6SetEnabled(ot, true);
    otThreadSetEnabled(ot, true);
}

// ---------------------------------------------------------------------------------------------
// Is the radio there? OpenThread hangs or restarts the hub if it is not, so ask it first.
// ---------------------------------------------------------------------------------------------

static uint16_t hdlc_fcs(const uint8_t *data, size_t len)
{
    uint16_t fcs = 0xffff;
    while (len--) {
        fcs ^= *data++;
        for (int i = 0; i < 8; i++) fcs = (fcs & 1) ? (fcs >> 1) ^ 0x8408 : fcs >> 1;
    }
    return fcs ^ 0xffff;
}

/** Spinel "get protocol version" (HDLC framed), and whether the radio answers it. */
static bool rcp_answers()
{
    const uint8_t req[] = {0x81 /* header, TID 1 */, 0x02 /* PROP_VALUE_GET */, 0x01 /* PROTOCOL_VERSION */};
    uint16_t fcs = hdlc_fcs(req, sizeof(req));
    uint8_t frame[16];
    size_t n = 0;
    frame[n++] = 0x7e;
    for (uint8_t b : {req[0], req[1], req[2], (uint8_t)(fcs & 0xff), (uint8_t)(fcs >> 8)}) {
        if (b == 0x7e || b == 0x7d || b == 0x11 || b == 0x13 || b == 0xf8) {
            frame[n++] = 0x7d;
            frame[n++] = b ^ 0x20;
        } else {
            frame[n++] = b;
        }
    }
    frame[n++] = 0x7e;
    uart_flush_input(UART_NUM_1);
    uart_write_bytes(UART_NUM_1, frame, n);

    // Noise or a radio's boot messages must not count: a frame with a valid FCS answering TID 1.
    uint8_t rx[64], f[32];
    int got = uart_read_bytes(UART_NUM_1, rx, sizeof(rx), pdMS_TO_TICKS(300));
    size_t len = 0;
    bool esc = false;
    for (int i = 0; i < got; i++) {
        uint8_t b = rx[i];
        if (b == 0x7e) {
            if (len >= 5 && hdlc_fcs(f, len - 2) == (f[len - 2] | f[len - 1] << 8) && f[0] == 0x81 && f[1] == 0x06 &&
                f[2] == 0x01)
                return true;
            len = 0;
            esc = false;
        } else if (b == 0x7d) {
            esc = true;
        } else if (len < sizeof(f)) {
            f[len++] = esc ? b ^ 0x20 : b;
            esc = false;
        }
    }
    return false;
}

/** What the radio sends at the ROM's 115200 baud: tells unpowered, restarting and silent apart. */
static void log_radio_output()
{
    uart_set_baudrate(UART_NUM_1, 115200);
    uart_flush_input(UART_NUM_1);
    char rx[160];
    int n = uart_read_bytes(UART_NUM_1, rx, sizeof(rx) - 1, pdMS_TO_TICKS(1500));
    uart_set_baudrate(UART_NUM_1, ESPM_OTBR_BAUD);
    if (n <= 0) {
        ESP_LOGW(TAG, "The radio sends nothing (not wired, or not running the radio firmware?)");
        return;
    }
    int zeros = 0;
    for (int i = 0; i < n; i++) zeros += rx[i] == 0;
    if (zeros * 2 > n) {
        // An idle line is high; an unpowered chip (fed only through its RX pin) pulls it low.
        ESP_LOGW(TAG, "The radio's TX line is held low – it is probably not powered (check 3V3 and GND)");
        return;
    }
    for (int i = 0; i < n; i++)
        if (rx[i] < 0x20 || rx[i] > 0x7e) rx[i] = '.';
    rx[n] = 0;
    ESP_LOGW(TAG, "The radio sends at 115200 baud: %s", rx);
    if (strstr(rx, "rst:") || strstr(rx, "ESP-ROM"))
        ESP_LOGW(TAG, "The radio keeps restarting – its power supply is probably too weak");
}

/** Until the radio answers (retrying, it may be powered later). */
static void wait_for_radio()
{
    uart_config_t cfg = {};
    cfg.baud_rate = ESPM_OTBR_BAUD;
    cfg.data_bits = UART_DATA_8_BITS;
    cfg.parity = UART_PARITY_DISABLE;
    cfg.stop_bits = UART_STOP_BITS_1;
    cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    cfg.source_clk = UART_SCLK_DEFAULT;
    // The driver only for each attempt: in between the hub may flash the radio over these wires.
    for (int attempt = 0;; attempt++) {
        xSemaphoreTake(s_wires, portMAX_DELAY);
        ESP_ERROR_CHECK(uart_driver_install(UART_NUM_1, 256, 0, 0, nullptr, 0));
        uart_param_config(UART_NUM_1, &cfg);
        uart_set_pin(UART_NUM_1, ESPM_OTBR_TX, ESPM_OTBR_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
        bool ok = rcp_answers();
        if (!ok && attempt % 30 == 2) {
            ESP_LOGE(TAG,
                     "No answer from the radio (hub TX GPIO%d → radio RX, hub RX GPIO%d ← radio TX, %d baud) – "
                     "check the wiring, GND and that the radio is flashed. Retrying…",
                     ESPM_OTBR_TX, ESPM_OTBR_RX, ESPM_OTBR_BAUD);
            log_radio_output();
        }
        uart_driver_delete(UART_NUM_1); // OpenThread installs its own driver on this port
        if (ok) break; // still holding the wires: OpenThread starts next
        xSemaphoreGive(s_wires);
        if (attempt >= 2) s_rcp = RCP_FAILED;
        vTaskDelay(pdMS_TO_TICKS(700));
    }
    ESP_LOGI(TAG, "Radio answered");
    s_rcp = RCP_STARTING;
}

// ---------------------------------------------------------------------------------------------
// The hub updates the radio while running: let go of the wires meanwhile (espm_slot_on_update)
// ---------------------------------------------------------------------------------------------

static rcp_state_t s_before_update;

static void release_radio()
{
    xSemaphoreTake(s_wires, portMAX_DELAY);
    s_before_update = s_rcp;
    s_rcp = RCP_UPDATING;
    if (!s_ot_running) return; // still looking for the radio: it waits for the wires
    esp_openthread_lock_acquire(portMAX_DELAY);
    otInstance *ot = esp_openthread_get_instance();
    // OpenThread keeps running without its radio – Thread and IPv6 have to be off for that.
    otThreadSetEnabled(ot, false);
    otIp6SetEnabled(ot, false);
    esp_err_t err = esp_openthread_rcp_deinit();
    esp_openthread_lock_release();
    if (err != ESP_OK) ESP_LOGE(TAG, "Letting go of the radio failed: %s", esp_err_to_name(err));
    else ESP_LOGI(TAG, "Thread paused for the radio's update");
}

static void reclaim_radio()
{
    if (!s_ot_running) {
        s_rcp = s_before_update;
        xSemaphoreGive(s_wires);
        return;
    }
    esp_openthread_lock_acquire(portMAX_DELAY);
    otInstance *ot = esp_openthread_get_instance();
    esp_err_t err = esp_openthread_rcp_init();
    if (err == ESP_OK) {
        otIp6SetEnabled(ot, true);
        otThreadSetEnabled(ot, true);
    }
    esp_openthread_lock_release();
    if (err == ESP_OK) {
        s_rcp = RCP_OK;
        ESP_LOGI(TAG, "Radio back, Thread resumed");
    } else {
        s_rcp = RCP_FAILED;
        ESP_LOGE(TAG, "The radio doesn't answer after its update: %s", esp_err_to_name(err));
    }
    xSemaphoreGive(s_wires);
}

static void ot_task(void *)
{
    // The hub may be installing the radio's update over these wires first.
    espm_slot_wait("radio");
    espm_slot_on_update("radio", release_radio, reclaim_radio);
    ESP_LOGI(TAG, "Connecting to the radio");
    wait_for_radio(); // holds s_wires from here until OpenThread runs
    esp_openthread_platform_config_t config = {};
    config.radio_config.radio_mode = RADIO_MODE_UART_RCP;
    config.radio_config.radio_uart_config.port = UART_NUM_1;
    config.radio_config.radio_uart_config.uart_config.baud_rate = ESPM_OTBR_BAUD;
    config.radio_config.radio_uart_config.uart_config.data_bits = UART_DATA_8_BITS;
    config.radio_config.radio_uart_config.uart_config.parity = UART_PARITY_DISABLE;
    config.radio_config.radio_uart_config.uart_config.stop_bits = UART_STOP_BITS_1;
    config.radio_config.radio_uart_config.uart_config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    config.radio_config.radio_uart_config.rx_pin = (gpio_num_t)ESPM_OTBR_RX;
    config.radio_config.radio_uart_config.tx_pin = (gpio_num_t)ESPM_OTBR_TX;
    config.host_config.host_connection_mode = HOST_CONNECTION_MODE_NONE;
    config.port_config.storage_partition_name = "nvs";
    config.port_config.netif_queue_size = 10;
    config.port_config.task_queue_size = 10;

    esp_vfs_eventfd_config_t eventfd = {.max_fds = 4};
    esp_vfs_eventfd_register(&eventfd);
    if (esp_openthread_init(&config) != ESP_OK) {
        ESP_LOGE(TAG, "OpenThread failed to start");
        s_rcp = RCP_FAILED;
        xSemaphoreGive(s_wires); // an update may still bring the radio back – at the next boot
        vTaskDelete(nullptr);
        return;
    }
    s_rcp = RCP_OK;
    esp_netif_config_t cfg = ESP_NETIF_DEFAULT_OPENTHREAD();
    esp_netif_t *netif = esp_netif_new(&cfg);
    esp_netif_attach(netif, esp_openthread_netif_glue_init(&config));

    esp_openthread_lock_acquire(portMAX_DELAY);
    otInstance *ot = esp_openthread_get_instance();
    if (!otDatasetIsCommissioned(ot) && ESPM_OTBR_AUTO_FORM) form_network(ot, ESPM_OTBR_CHANNEL);
    else {
        otIp6SetEnabled(ot, true);
        otThreadSetEnabled(ot, true);
    }
    // Under the lock: infra_if_init releases and re-takes it while waiting (asserts otherwise).
    esp_openthread_set_backbone_netif(esp_netif_get_default_netif());
    esp_openthread_border_router_init();
    s_ot_running = true;
    esp_openthread_lock_release();
    xSemaphoreGive(s_wires);

    esp_openthread_launch_mainloop();
}

void espm_otbr_start()
{
    s_wires = xSemaphoreCreateMutex();
    mdns_init();
    mdns_hostname_set(espm_hostname());
    // esp_openthread_init() logs a lot: 8 KB overflowed into the heap before.
    if (xTaskCreate(ot_task, "espm_otbr", 12288, nullptr, 5, nullptr) != pdPASS) {
        ESP_LOGE(TAG, "No memory for the Thread task (%u bytes internal RAM free)",
                 (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
        s_rcp = RCP_FAILED;
    }
}

size_t espm_otbr_dataset(uint8_t *buf, size_t size)
{
    if (s_rcp != RCP_OK) return 0;
    otOperationalDatasetTlvs tlvs;
    esp_openthread_lock_acquire(portMAX_DELAY);
    otError err = otDatasetGetActiveTlvs(esp_openthread_get_instance(), &tlvs);
    esp_openthread_lock_release();
    if (err != OT_ERROR_NONE || tlvs.mLength > size) return 0;
    memcpy(buf, tlvs.mTlvs, tlvs.mLength);
    return tlvs.mLength;
}

#if ESPM_HTTP
static const char *role_name(otDeviceRole role)
{
    switch (role) {
    case OT_DEVICE_ROLE_LEADER: return "leader";
    case OT_DEVICE_ROLE_ROUTER: return "router";
    case OT_DEVICE_ROLE_CHILD: return "child";
    case OT_DEVICE_ROLE_DETACHED: return "detached";
    default: return "disabled";
    }
}

static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "rcp", s_rcp == RCP_OK         ? "ok"
                                          : s_rcp == RCP_STARTING ? "starting"
                                          : s_rcp == RCP_UPDATING ? "updating"
                                                                  : "no answer");
    if (s_rcp == RCP_OK) {
        esp_openthread_lock_acquire(portMAX_DELAY);
        otInstance *ot = esp_openthread_get_instance();
        cJSON_AddStringToObject(json, "role", role_name(otThreadGetDeviceRole(ot)));
        cJSON_AddStringToObject(json, "networkName", otThreadGetNetworkName(ot));
        cJSON_AddNumberToObject(json, "channel", otLinkGetChannel(ot));
        char pan[8];
        snprintf(pan, sizeof(pan), "0x%04x", otLinkGetPanId(ot));
        cJSON_AddStringToObject(json, "panId", pan);
        otRouterInfo info;
        int routers = 0;
        for (uint8_t id = 0; id <= OT_NETWORK_MAX_ROUTER_ID; id++)
            if (otThreadGetRouterInfo(ot, id, &info) == OT_ERROR_NONE) routers++;
        cJSON_AddNumberToObject(json, "routers", routers);
        otChildInfo child;
        int children = 0;
        for (uint16_t i = 0; i < otThreadGetMaxAllowedChildren(ot); i++)
            if (otThreadGetChildInfoByIndex(ot, i, &child) == OT_ERROR_NONE) children++;
        cJSON_AddNumberToObject(json, "children", children);
        esp_openthread_lock_release();
    }
    return espm_send_json(req, json);
}

static esp_err_t dataset(httpd_req_t *req)
{
    if (s_rcp != RCP_OK) return espm_send_error(req, 503, s_rcp == RCP_FAILED ? "radio not running" : "radio still starting");
    otOperationalDatasetTlvs tlvs;
    esp_openthread_lock_acquire(portMAX_DELAY);
    otError err = otDatasetGetActiveTlvs(esp_openthread_get_instance(), &tlvs);
    esp_openthread_lock_release();
    if (err != OT_ERROR_NONE) return espm_send_error(req, 404, "no active dataset");
    char hex[OT_OPERATIONAL_DATASET_MAX_LENGTH * 2 + 1];
    for (int i = 0; i < tlvs.mLength; i++) sprintf(hex + i * 2, "%02x", tlvs.mTlvs[i]);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "tlvs", hex);
    return espm_send_json(req, json);
}

static esp_err_t form(httpd_req_t *req)
{
    if (s_rcp != RCP_OK) return espm_send_error(req, 503, s_rcp == RCP_FAILED ? "radio not running" : "radio still starting");
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *ch = cJSON_GetObjectItem(body, "channel");
    int channel = cJSON_IsNumber(ch) ? (int)ch->valuedouble : ESPM_OTBR_CHANNEL;
    cJSON_Delete(body);
    esp_openthread_lock_acquire(portMAX_DELAY);
    otInstance *ot = esp_openthread_get_instance();
    otThreadSetEnabled(ot, false);
    form_network(ot, channel);
    esp_openthread_lock_release();
    return espm_send_ok(req);
}

struct OtbrRoutes {
    OtbrRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/thread", status);
        espm_route(HTTP_GET, "/api/v1/thread/dataset", dataset);
        espm_route(HTTP_POST, "/api/v1/thread/form", form);
    }
};
static OtbrRoutes s_routes;
#endif
