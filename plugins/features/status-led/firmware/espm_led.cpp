// espmatter studio – status LED: blue blink while not paired, short green flash when online,
// white blink while a controller identifies the device.
#include "espm.h"
#include "espm_led.h"

#include <driver/gpio.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <app/server/Server.h>
#if ESPM_LED_WS2812
#include <led_strip.h>
static led_strip_handle_t s_strip;
#endif

static void set(uint8_t r, uint8_t g, uint8_t b)
{
#if ESPM_LED_WS2812
    int k = ESPM_LED_BRIGHTNESS;
    led_strip_set_pixel(s_strip, 0, r * k / 100, g * k / 100, b * k / 100);
    led_strip_refresh(s_strip);
#else
    gpio_set_level((gpio_num_t)ESPM_LED_GPIO, ((r | g | b) != 0) ^ ESPM_LED_ACTIVE_LOW);
#endif
}

static void task(void *)
{
    bool flashed = false;
    for (int tick = 0;; tick++) {
        bool paired = chip::Server::GetInstance().GetFabricTable().FabricCount() > 0;
        if (!paired) set(0, 0, (tick % 2) ? 255 : 0);
        else if (espm_online() && !flashed) {
            set(0, 255, 0);
            vTaskDelay(pdMS_TO_TICKS(1500));
            flashed = true;
            set(0, 0, 0);
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void espm_led_start()
{
    if (ESPM_LED_GPIO < 0) return;
#if ESPM_LED_WS2812
    led_strip_config_t strip = {};
    strip.strip_gpio_num = ESPM_LED_GPIO;
    strip.max_leds = 1;
    led_strip_rmt_config_t rmt = {};
    rmt.resolution_hz = 10 * 1000 * 1000;
    led_strip_new_rmt_device(&strip, &rmt, &s_strip);
#else
    gpio_set_direction((gpio_num_t)ESPM_LED_GPIO, GPIO_MODE_OUTPUT);
#endif
    set(0, 0, 0);
    xTaskCreate(task, "espm_led", 3072, nullptr, 1, nullptr);
}
