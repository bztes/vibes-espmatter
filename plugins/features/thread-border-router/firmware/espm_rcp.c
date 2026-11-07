// espmatter studio – OpenThread radio co-processor (Spinel over UART) for the hub's border router.
// Based on esp-idf examples/openthread/ot_rcp.
#include "espm_config.h"
#include "espm_rcp.h"

#include "esp_openthread.h"
#include "esp_vfs_eventfd.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/** OpenThread's Spinel interface on the host UART – without it the radio never answers. */
extern void otAppNcpInit(otInstance *instance);

static void rcp_task(void *arg)
{
    esp_openthread_platform_config_t config = {
        .radio_config = {.radio_mode = RADIO_MODE_NATIVE},
        .host_config =
            {
                .host_connection_mode = HOST_CONNECTION_MODE_RCP_UART,
                .host_uart_config =
                    {
                        .port = UART_NUM_0,
                        .uart_config =
                            {
                                .baud_rate = ESPM_RCP_BAUD,
                                .data_bits = UART_DATA_8_BITS,
                                .parity = UART_PARITY_DISABLE,
                                .stop_bits = UART_STOP_BITS_1,
                                .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
                                .source_clk = UART_SCLK_DEFAULT,
                            },
                        .rx_pin = ESPM_RCP_RX,
                        .tx_pin = ESPM_RCP_TX,
                    },
            },
        .port_config = {.storage_partition_name = "nvs", .netif_queue_size = 10, .task_queue_size = 10},
    };
    esp_vfs_eventfd_config_t eventfd = {.max_fds = 2};
    esp_vfs_eventfd_register(&eventfd);
    ESP_ERROR_CHECK(esp_openthread_init(&config));
    otAppNcpInit(esp_openthread_get_instance());
    esp_openthread_launch_mainloop();
    esp_openthread_deinit();
    vTaskDelete(NULL);
}

void espm_rcp_start(void)
{
    xTaskCreate(rcp_task, "ot_rcp", 3072, NULL, 5, NULL);
}
