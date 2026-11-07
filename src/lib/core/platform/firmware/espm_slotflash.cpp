// espmatter studio – the main board flashes boards wired to it (SlotDef.flashOverWire).
//
// A board's updates are deployments like the main board's: the app (or, on a Thread device, a hub's
// update relay) answers `/devices/<id>/update?slot=<board>` with the image to install. Once online,
// before any plugin uses the wires (espm_slot_wait), the main board asks for each board's update
// and, if there is one:
//
//   1. pulls the trigger line low – the board's espm_slotboot.c restarts it into the ROM's serial
//      download mode (no reset/boot pins needed),
//   2. streams the image from the app into the board's flash, 1 KB at a time, with the ROM loader
//      protocol (as esptool does, without the stub) over the board's UART0, and checks it (MD5 of
//      the flash, SHA-256 of the download),
//   3. clears the board's force-download flag, reboots it into the new firmware and reports back.
//
// An update found while running (the main board's update check) is installed right away: the
// plugin using the wires lets go of them meanwhile (espm_slot_on_update). A plugin that can't
// makes it a restart of the main board instead, the update is then installed at boot.
// Only the app is replaced – bootloader and partition table stay from the first (USB) flash.
#include "espm_slotflash.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include <driver/gpio.h>
#include <driver/uart.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_rom_md5.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <freertos/task.h>
#include <mbedtls/sha256.h>
#include <nvs.h>

#include "espm.h"

static const char *TAG = "espm_slotflash";

#define PORT UART_NUM_1
#define SYNC_BAUD 115200
#define FAST_BAUD 460800
/** The ROM loader writes 1 KB blocks. */
#define BLOCK 0x400
/** ROM replies end in 4 status bytes (the stub's in 2). */
#define STATUS_LEN 4
#define NVS_NS "espm_slots"
/** How long the plugins wait for the network before the boards start without an update check. */
#define ONLINE_WAIT_MS 60000

enum : uint8_t {
    CMD_FLASH_BEGIN = 0x02,
    CMD_FLASH_DATA = 0x03,
    CMD_FLASH_END = 0x04,
    CMD_SYNC = 0x08,
    CMD_WRITE_REG = 0x09,
    CMD_READ_REG = 0x0a,
    CMD_SPI_SET_PARAMS = 0x0b,
    CMD_SPI_ATTACH = 0x0d,
    CMD_CHANGE_BAUDRATE = 0x0f,
    CMD_SPI_FLASH_MD5 = 0x13,
};

static uint8_t s_pkt[16 + BLOCK];
static uint8_t s_tx[2 * (8 + sizeof(s_pkt)) + 2];
static uint8_t s_rx[128];

// ---------------------------------------------------------------------------------------------
// ROM loader protocol: SLIP frames of {dir, cmd, size, checksum/value, data}
// ---------------------------------------------------------------------------------------------

static void put32(uint8_t *p, uint32_t v)
{
    p[0] = v;
    p[1] = v >> 8;
    p[2] = v >> 16;
    p[3] = v >> 24;
}

static uint32_t get32(const uint8_t *p) { return p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24; }

static int64_t now_ms() { return esp_timer_get_time() / 1000; }

static void slip_put(size_t &n, uint8_t b)
{
    if (b == 0xc0) {
        s_tx[n++] = 0xdb;
        s_tx[n++] = 0xdc;
    } else if (b == 0xdb) {
        s_tx[n++] = 0xdb;
        s_tx[n++] = 0xdd;
    } else {
        s_tx[n++] = b;
    }
}

static void send(uint8_t op, const uint8_t *data, uint16_t len, uint32_t checksum)
{
    uint8_t header[8] = {0x00, op, (uint8_t)len, (uint8_t)(len >> 8)};
    put32(header + 4, checksum);
    size_t n = 0;
    s_tx[n++] = 0xc0;
    for (uint8_t b : header) slip_put(n, b);
    for (uint16_t i = 0; i < len; i++) slip_put(n, data[i]);
    s_tx[n++] = 0xc0;
    uart_write_bytes(PORT, s_tx, n);
}

/** The next SLIP frame (decoded) into s_rx: its length, or -1 on timeout. */
static int read_frame(int timeout_ms)
{
    int64_t until = now_ms() + timeout_ms;
    bool in = false, esc = false;
    size_t n = 0;
    for (;;) {
        int64_t left = until - now_ms();
        if (left <= 0) return -1;
        uint8_t b;
        if (uart_read_bytes(PORT, &b, 1, pdMS_TO_TICKS(left) ? pdMS_TO_TICKS(left) : 1) != 1) continue;
        if (!in) {
            if (b == 0xc0) in = true, n = 0;
            continue;
        }
        if (b == 0xc0) {
            if (n) return n;
            continue; // two delimiters in a row: still the start
        }
        if (esc) {
            b = b == 0xdc ? 0xc0 : b == 0xdd ? 0xdb : b;
            esc = false;
        } else if (b == 0xdb) {
            esc = true;
            continue;
        }
        if (n < sizeof(s_rx)) s_rx[n++] = b;
    }
}

/** Send a command and wait for its reply. `out` gets the reply's data before the status bytes. */
static esp_err_t command(uint8_t op, const uint8_t *data, uint16_t len, uint32_t checksum, int timeout_ms,
                         uint32_t *value = nullptr, uint8_t *out = nullptr, size_t out_len = 0)
{
    send(op, data, len, checksum);
    int64_t until = now_ms() + timeout_ms;
    for (;;) {
        int64_t left = until - now_ms();
        if (left <= 0) return ESP_ERR_TIMEOUT;
        int n = read_frame(left);
        if (n < 0) return ESP_ERR_TIMEOUT;
        if (n < 8 || s_rx[0] != 0x01 || s_rx[1] != op) continue; // e.g. more answers to a SYNC
        uint16_t size = s_rx[2] | s_rx[3] << 8;
        if (size > n - 8) size = n - 8;
        size_t status_len = size >= STATUS_LEN ? STATUS_LEN : 2;
        if (size < status_len) return ESP_ERR_INVALID_RESPONSE;
        const uint8_t *payload = s_rx + 8;
        if (payload[size - status_len] != 0) {
            ESP_LOGW(TAG, "Command 0x%02x failed (error 0x%02x)", op, payload[size - status_len + 1]);
            return ESP_FAIL;
        }
        if (value) *value = get32(s_rx + 4);
        if (out) memcpy(out, payload, out_len < size - status_len ? out_len : size - status_len);
        return ESP_OK;
    }
}

static bool sync(int attempts)
{
    uint8_t data[36] = {0x07, 0x07, 0x12, 0x20};
    memset(data + 4, 0x55, 32);
    for (int i = 0; i < attempts; i++) {
        uart_flush_input(PORT);
        if (command(CMD_SYNC, data, sizeof(data), 0, 100) == ESP_OK) {
            // The ROM answers a SYNC several times.
            while (read_frame(50) >= 0) {
            }
            return true;
        }
    }
    return false;
}

static uint32_t checksum(const uint8_t *data, size_t len)
{
    uint8_t c = 0xef;
    for (size_t i = 0; i < len; i++) c ^= data[i];
    return c;
}

static int timeout_per_mb(int ms_per_mb, size_t size)
{
    int t = (int)((int64_t)ms_per_mb * size / (1024 * 1024));
    return t < 3000 ? 3000 : t;
}

static void md5_hex(const uint8_t digest[16], char out[33])
{
    for (int i = 0; i < 16; i++) sprintf(out + 2 * i, "%02x", digest[i]);
}

// ---------------------------------------------------------------------------------------------
// State per board
// ---------------------------------------------------------------------------------------------

struct slot_state_t {
    /** Installed by the main board (NVS): build version and SHA-256 of the app. 0: unknown. */
    int version;
    char sha256[65];
    const char *state; // idle | flashing | failed
    int progress;
    char error[96];
    /** An update of this version failed: don't try it again until the next boot. */
    int failed_version;
    /** The plugin using the wires (espm_slot_on_update), or nullptr. */
    void (*release)();
    void (*reclaim)();
};
static slot_state_t *s_state;
static EventGroupHandle_t s_ready;

static void nvs_key(char *key, const char *prefix, const char *id) { snprintf(key, 16, "%s%s", prefix, id); }

static void load(int i)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READONLY, &nvs) != ESP_OK) return;
    char key[16];
    int32_t version = 0;
    nvs_key(key, "v_", espm_slots[i].id);
    if (nvs_get_i32(nvs, key, &version) == ESP_OK) s_state[i].version = version;
    size_t len = sizeof(s_state[i].sha256);
    nvs_key(key, "s_", espm_slots[i].id);
    nvs_get_str(nvs, key, s_state[i].sha256, &len);
    nvs_close(nvs);
}

static void save(int i)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) != ESP_OK) return;
    char key[16];
    nvs_key(key, "v_", espm_slots[i].id);
    nvs_set_i32(nvs, key, s_state[i].version);
    nvs_key(key, "s_", espm_slots[i].id);
    nvs_set_str(nvs, key, s_state[i].sha256);
    nvs_commit(nvs);
    nvs_close(nvs);
}

// ---------------------------------------------------------------------------------------------
// Flashing one board
// ---------------------------------------------------------------------------------------------

static void trigger(int gpio, bool low)
{
    if (low) {
        gpio_set_level((gpio_num_t)gpio, 0);
        gpio_set_direction((gpio_num_t)gpio, GPIO_MODE_OUTPUT);
    } else {
        // Released: the board's pull-up holds it high.
        gpio_set_direction((gpio_num_t)gpio, GPIO_MODE_INPUT);
    }
}

/** Into the ROM's download mode: maybe it already is (an interrupted update), else ask the firmware. */
static bool enter_download_mode(const espm_slot_t &slot)
{
    if (sync(2)) return true;
    trigger(slot.trigger, true);
    vTaskDelay(pdMS_TO_TICKS(400)); // the board waits 200 ms against glitches
    trigger(slot.trigger, false);
    // Its ROM banner tells how it restarted ("boot:0x.. (DOWNLOAD..." or a normal boot).
    char banner[200];
    size_t n = 0;
    int64_t until = now_ms() + 300;
    while (n < sizeof(banner) - 1 && now_ms() < until) {
        uint8_t b;
        if (uart_read_bytes(PORT, &b, 1, pdMS_TO_TICKS(20)) == 1) banner[n++] = b >= 0x20 && b < 0x7f ? b : ' ';
    }
    banner[n] = 0;
    ESP_LOGI(TAG, "%s after the trigger: %s", slot.name, n ? banner : "(nothing)");
    return sync(30);
}

/** The ROM loader is ready: talk faster, attach the flash. */
static bool prepare(const espm_slot_t &slot)
{
    uint8_t baud[8] = {};
    put32(baud, FAST_BAUD);
    if (command(CMD_CHANGE_BAUDRATE, baud, sizeof(baud), 0, 1000) == ESP_OK) {
        uart_set_baudrate(PORT, FAST_BAUD);
        vTaskDelay(pdMS_TO_TICKS(50));
        uart_flush_input(PORT);
    }
    uint8_t attach[8] = {};
    uint8_t params[24] = {};
    put32(params + 4, slot.flash_size);
    put32(params + 8, 64 * 1024);
    put32(params + 12, 4 * 1024);
    put32(params + 16, 256);
    put32(params + 20, 0xffff);
    return command(CMD_SPI_ATTACH, attach, sizeof(attach), 0, 3000) == ESP_OK &&
           command(CMD_SPI_SET_PARAMS, params, sizeof(params), 0, 3000) == ESP_OK;
}

/** Boot normally from now on, then reboot ("flash end" with reboot). */
static void leave(const espm_slot_t &slot)
{
    uint32_t reg = 0;
    uint8_t addr[4];
    put32(addr, slot.force_reg);
    if (command(CMD_READ_REG, addr, sizeof(addr), 0, 1000, &reg) == ESP_OK) {
        uint8_t write[16];
        put32(write, slot.force_reg);
        put32(write + 4, reg & ~slot.force_mask);
        put32(write + 8, 0xffffffff);
        put32(write + 12, 0);
        command(CMD_WRITE_REG, write, sizeof(write), 0, 1000);
    }
    uint8_t begin[20] = {};
    put32(begin + 8, BLOCK);
    command(CMD_FLASH_BEGIN, begin, sizeof(begin), 0, 3000);
    uint8_t reboot[4] = {}; // 0: reboot, 1: run the app without a reset
    command(CMD_FLASH_END, reboot, sizeof(reboot), 0, 500);
}

/** Stream the image into the board's app partition. */
static esp_err_t write_app(const espm_slot_t &slot, slot_state_t &st, esp_http_client_handle_t src, size_t size,
                           const char *want_sha256, char sha256_out[65])
{
    uint32_t blocks = (size + BLOCK - 1) / BLOCK;
    uint8_t params[20] = {};
    put32(params, size); // erase size
    put32(params + 4, blocks);
    put32(params + 8, BLOCK);
    put32(params + 12, slot.app_offset);
    put32(params + 16, 0); // not encrypted
    // The ROM erases up front.
    if (command(CMD_FLASH_BEGIN, params, sizeof(params), 0, timeout_per_mb(30000, size)) != ESP_OK) {
        snprintf(st.error, sizeof(st.error), "Erasing the board's flash failed");
        return ESP_FAIL;
    }
    md5_context_t md5;
    esp_rom_md5_init(&md5);
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);
    esp_err_t err = ESP_OK;
    size_t done = 0;
    for (uint32_t seq = 0; seq < blocks && err == ESP_OK; seq++) {
        size_t chunk = size - done < BLOCK ? size - done : BLOCK;
        size_t got = 0;
        while (got < chunk) {
            int n = esp_http_client_read(src, (char *)s_pkt + 16 + got, chunk - got);
            if (n <= 0) break;
            got += n;
        }
        if (got < chunk) {
            snprintf(st.error, sizeof(st.error), "Download interrupted at %u bytes", (unsigned)(done + got));
            err = ESP_ERR_INVALID_SIZE;
            break;
        }
        esp_rom_md5_update(&md5, s_pkt + 16, chunk);
        mbedtls_sha256_update(&sha, s_pkt + 16, chunk);
        memset(s_pkt, 0, 16);
        put32(s_pkt, BLOCK);
        put32(s_pkt + 4, seq);
        memset(s_pkt + 16 + chunk, 0xff, BLOCK - chunk);
        uint32_t chk = checksum(s_pkt + 16, BLOCK);
        for (int attempt = 0; attempt < 3; attempt++) {
            err = command(CMD_FLASH_DATA, s_pkt, sizeof(s_pkt), chk, 3000);
            if (err == ESP_OK) break;
        }
        if (err != ESP_OK) snprintf(st.error, sizeof(st.error), "Writing block %lu failed", (unsigned long)seq);
        done += chunk;
        st.progress = (int)(done * 100 / size);
    }
    uint8_t digest[32];
    mbedtls_sha256_finish(&sha, digest);
    mbedtls_sha256_free(&sha);
    for (int i = 0; i < 32; i++) sprintf(sha256_out + 2 * i, "%02x", digest[i]);
    if (err != ESP_OK) return err;
    if (want_sha256[0] && strcasecmp(want_sha256, sha256_out) != 0) {
        snprintf(st.error, sizeof(st.error), "The download doesn't match its SHA-256");
        return ESP_ERR_INVALID_CRC;
    }
    // What the flash holds now must be what was downloaded.
    uint8_t md5_digest[16];
    esp_rom_md5_final(md5_digest, &md5);
    char want[33], have[33] = {};
    md5_hex(md5_digest, want);
    uint8_t md5_params[16] = {};
    put32(md5_params, slot.app_offset);
    put32(md5_params + 4, size);
    if (command(CMD_SPI_FLASH_MD5, md5_params, sizeof(md5_params), 0, timeout_per_mb(8000, size), nullptr,
                (uint8_t *)have, 32) != ESP_OK ||
        strncasecmp(have, want, 32) != 0) {
        snprintf(st.error, sizeof(st.error), "Verifying the board's flash failed");
        return ESP_ERR_INVALID_CRC;
    }
    return ESP_OK;
}

/** Flash `size` bytes downloading from `src` (SHA-256 `sha256`, "" if unknown) as `version` of board `i`. */
static esp_err_t flash(int i, int version, size_t size, const char *want_sha256, esp_http_client_handle_t src)
{
    const espm_slot_t &slot = espm_slots[i];
    slot_state_t &st = s_state[i];
    if (!size || size > slot.app_max) {
        snprintf(st.error, sizeof(st.error), size ? "Image larger than the board's app partition" : "Image size unknown");
        return ESP_ERR_INVALID_SIZE;
    }

    uart_config_t cfg = {};
    cfg.baud_rate = SYNC_BAUD;
    cfg.data_bits = UART_DATA_8_BITS;
    cfg.parity = UART_PARITY_DISABLE;
    cfg.stop_bits = UART_STOP_BITS_1;
    cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    cfg.source_clk = UART_SCLK_DEFAULT;
    if (uart_driver_install(PORT, 1024, 0, 0, nullptr, 0) != ESP_OK) {
        snprintf(st.error, sizeof(st.error), "UART busy");
        return ESP_FAIL;
    }
    uart_param_config(PORT, &cfg);
    uart_set_pin(PORT, slot.tx, slot.rx, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    trigger(slot.trigger, false);

    st.state = "flashing";
    st.progress = 0;
    st.error[0] = 0;
    int64_t started = esp_timer_get_time();
    esp_err_t err = ESP_FAIL;
    char sha256[65] = {};
    if (!enter_download_mode(slot)) {
        snprintf(st.error, sizeof(st.error), "No answer – flash it over USB once and check the wiring");
    } else if (!prepare(slot)) {
        snprintf(st.error, sizeof(st.error), "The board's flash did not respond");
    } else {
        ESP_LOGI(TAG, "%s: writing version %d (%u bytes)", slot.name, version, (unsigned)size);
        err = write_app(slot, st, src, size, want_sha256, sha256);
        // Back to its firmware either way: the new one, or (failed) whatever is in flash.
        leave(slot);
    }
    uart_driver_delete(PORT);
    trigger(slot.trigger, false);
    if (err == ESP_OK) {
        st.state = "idle";
        st.version = version;
        strlcpy(st.sha256, sha256, sizeof(st.sha256));
        save(i);
        ESP_LOGI(TAG, "%s: version %d installed in %lld ms", slot.name, version,
                 (esp_timer_get_time() - started) / 1000);
        vTaskDelay(pdMS_TO_TICKS(500)); // the board boots its new firmware
    } else {
        st.state = "failed";
        st.failed_version = version;
        ESP_LOGE(TAG, "%s: %s", slot.name, st.error);
    }
    return err;
}

// ---------------------------------------------------------------------------------------------
// Updates: the app (or a hub's relay) has one
// ---------------------------------------------------------------------------------------------

/** Ask for the board's update and install it. */
static void update(int i)
{
    const espm_slot_t &slot = espm_slots[i];
    slot_state_t &st = s_state[i];
    espm_update_t u;
    if (!espm_update_manifest(slot.id, st.version, &u)) {
        espm_update_report(slot.id, "running", st.version, st.version, nullptr);
        return;
    }
    // The same app under another version (a rebuild that didn't change it): nothing to flash.
    if (u.sha256[0] && strcasecmp(u.sha256, st.sha256) == 0) {
        st.version = u.version;
        save(i);
        espm_update_report(slot.id, "installed", u.version, u.version, nullptr);
        return;
    }
    ESP_LOGI(TAG, "%s: update to version %d", slot.name, u.version);
    espm_update_report(slot.id, "downloading", u.version, st.version, nullptr);
    int64_t length = 0;
    esp_http_client_handle_t client = espm_update_open(u.url, &length);
    esp_err_t err = ESP_FAIL;
    if (!client) {
        st.state = "failed";
        st.failed_version = u.version;
        snprintf(st.error, sizeof(st.error), "Download failed");
    } else {
        err = flash(i, u.version, length > 0 ? (size_t)length : (size_t)u.size, u.sha256, client);
        esp_http_client_cleanup(client);
    }
    if (err == ESP_OK) espm_update_report(slot.id, "installed", u.version, u.version, nullptr);
    else espm_update_report(slot.id, "failed", u.version, st.version, st.error);
}

static void restart_later(void *)
{
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
}

/** An install found while running is underway (one at a time). */
static volatile bool s_busy;

/** While running: the plugin lets go of the wires, the board is flashed and restarted, the plugin takes them back. */
static void install_task(void *arg)
{
    int i = (int)(intptr_t)arg;
    slot_state_t &st = s_state[i];
    ESP_LOGI(TAG, "%s: pausing its plugin for the update", espm_slots[i].name);
    st.release();
    update(i);
    st.reclaim();
    s_busy = false;
    vTaskDelete(nullptr);
}

void espm_slotflash_check()
{
    // At boot the boards are checked (and flashed) by boot_task – acting now would interrupt that.
    const EventBits_t all = (1 << espm_slot_count) - 1;
    if (!s_ready || (xEventGroupGetBits(s_ready) & all) != all || s_busy) return;
    for (int i = 0; i < espm_slot_count; i++) {
        espm_update_t u;
        if (!espm_update_manifest(espm_slots[i].id, s_state[i].version, &u)) continue;
        if (u.version == s_state[i].failed_version) continue; // failed before: don't loop
        if (u.sha256[0] && strcasecmp(u.sha256, s_state[i].sha256) == 0) continue;
        if (s_state[i].release) {
            ESP_LOGI(TAG, "%s: version %d available – installing it", espm_slots[i].name, u.version);
            s_busy = true;
            if (xTaskCreate(install_task, "espm_slotflash", 6144, (void *)(intptr_t)i, 4, nullptr) != pdPASS)
                s_busy = false;
            return;
        }
        // Its plugin can't let go of the wires: install at the next boot, before the plugin starts.
        ESP_LOGI(TAG, "%s: version %d available – restarting to install it", espm_slots[i].name, u.version);
        xTaskCreate(restart_later, "restart", 2048, nullptr, 5, nullptr);
        return;
    }
}

static void boot_task(void *)
{
    int64_t until = esp_timer_get_time() / 1000 + ONLINE_WAIT_MS;
    while (!espm_online() && esp_timer_get_time() / 1000 < until) vTaskDelay(pdMS_TO_TICKS(500));
    if (espm_online())
        for (int i = 0; i < espm_slot_count; i++) {
            if (ESPM_UPDATE_PULL_ON) update(i);
            else espm_update_report(espm_slots[i].id, "running", s_state[i].version, s_state[i].version, nullptr);
        }
    xEventGroupSetBits(s_ready, (1 << espm_slot_count) - 1);
    vTaskDelete(nullptr);
}

void espm_slot_on_update(const char *id, void (*release)(), void (*reclaim)())
{
    if (!s_state) return; // call it once espm_slot_wait returned
    for (int i = 0; i < espm_slot_count; i++)
        if (strcmp(espm_slots[i].id, id) == 0) {
            s_state[i].release = release;
            s_state[i].reclaim = reclaim;
        }
}

void espm_slot_wait(const char *id)
{
    for (int i = 0; i < espm_slot_count; i++)
        if (strcmp(espm_slots[i].id, id) == 0) {
            xEventGroupWaitBits(s_ready, 1 << i, pdFALSE, pdTRUE, portMAX_DELAY);
            return;
        }
}

// ---------------------------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------------------------

#if ESPM_HTTP
static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON *list = cJSON_AddArrayToObject(json, "slots");
    for (int i = 0; i < espm_slot_count; i++) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddStringToObject(o, "id", espm_slots[i].id);
        cJSON_AddStringToObject(o, "name", espm_slots[i].name);
        cJSON_AddStringToObject(o, "chip", espm_slots[i].chip);
        cJSON_AddNumberToObject(o, "version", s_state[i].version);
        cJSON_AddStringToObject(o, "state", s_state[i].state);
        cJSON_AddNumberToObject(o, "progress", s_state[i].progress);
        cJSON_AddStringToObject(o, "error", s_state[i].error);
        cJSON_AddItemToArray(list, o);
    }
    return espm_send_json(req, json);
}
#endif

void espm_slotflash_start(void)
{
    s_state = (slot_state_t *)calloc(espm_slot_count, sizeof(slot_state_t));
    s_ready = xEventGroupCreate();
    for (int i = 0; i < espm_slot_count; i++) {
        s_state[i].state = "idle";
        load(i);
    }
#if ESPM_HTTP
    espm_route(HTTP_GET, "/api/v1/slots", status);
#endif
    xTaskCreate(boot_task, "espm_slotflash", 6144, nullptr, 4, nullptr);
}
