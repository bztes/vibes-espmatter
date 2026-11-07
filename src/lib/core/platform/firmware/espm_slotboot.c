// espmatter studio – on a board the main board flashes over a wire: switch to download mode on request.
//
// No reset or boot pin needed: the firmware itself sets the chip's "force download boot" flag and
// restarts, the ROM then waits on UART0 for the main board (espm_slotflash.cpp), which clears the
// flag again before it reboots the board into its new firmware.
#include "espm_config.h"
#include "espm_slotboot.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "soc/soc.h"

#if CONFIG_IDF_TARGET_ESP32C3 || CONFIG_IDF_TARGET_ESP32S3
#include "soc/rtc_cntl_reg.h"
#define FORCE_DOWNLOAD_BOOT() REG_SET_BIT(RTC_CNTL_OPTION1_REG, RTC_CNTL_FORCE_DOWNLOAD_BOOT)
#elif CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C6 || CONFIG_IDF_TARGET_ESP32C61 ||        \
    CONFIG_IDF_TARGET_ESP32H2
#include "soc/lp_aon_reg.h"
#define FORCE_DOWNLOAD_BOOT() REG_SET_BIT(LP_AON_SYS_CFG_REG, LP_AON_FORCE_DOWNLOAD_BOOT)
#else
#error "This chip can't switch to download mode by software – it can't be flashed over a wire."
#endif

static const char *TAG = "espm_slotboot";

/** Low this long (not a glitch while the main board boots) means: switch to download mode. */
#define HOLD_MS 200
#define POLL_MS 20

static void slotboot_task(void *arg)
{
    int low_ms = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        low_ms = gpio_get_level(ESPM_SLOTBOOT_TRIGGER) ? 0 : low_ms + POLL_MS;
        if (low_ms >= HOLD_MS) {
            ESP_LOGW(TAG, "Main board asks for an update: restarting into download mode");
            FORCE_DOWNLOAD_BOOT();
            esp_restart();
        }
    }
}

void espm_slotboot_start(void)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << ESPM_SLOTBOOT_TRIGGER,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io));
    xTaskCreate(slotboot_task, "slotboot", 2048, NULL, 10, NULL);
}
