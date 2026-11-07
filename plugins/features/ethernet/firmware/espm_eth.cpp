// espmatter studio – Ethernet with the ESP32's EMAC and an RMII PHY.
#include "espm.h"
#include "espm_eth.h"

#include <driver/gpio.h>
#include <esp_eth.h>
#include <esp_eth_mac_esp.h>
#include <esp_event.h>
#include <esp_log.h>
#include <esp_netif.h>

static const char *TAG = "espm_eth";
static esp_eth_handle_t s_eth;
static bool s_link;

static void on_event(void *, esp_event_base_t, int32_t id, void *)
{
    s_link = id == ETHERNET_EVENT_CONNECTED;
    ESP_LOGI(TAG, "Link %s", s_link ? "up" : "down");
}

void espm_eth_init()
{
    if (ESPM_ETH_POWER >= 0) {
        gpio_set_direction((gpio_num_t)ESPM_ETH_POWER, GPIO_MODE_OUTPUT);
        gpio_set_level((gpio_num_t)ESPM_ETH_POWER, 1);
    }
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_config_t netif_cfg = ESP_NETIF_DEFAULT_ETH();
    esp_netif_t *netif = esp_netif_new(&netif_cfg);

    eth_mac_config_t mac_cfg = ETH_MAC_DEFAULT_CONFIG();
    eth_esp32_emac_config_t emac = ETH_ESP32_EMAC_DEFAULT_CONFIG();
    emac.smi_gpio.mdc_num = ESPM_ETH_MDC;
    emac.smi_gpio.mdio_num = ESPM_ETH_MDIO;
#if ESPM_ETH_CLOCK_GPIO0_IN
    emac.clock_config.rmii.clock_mode = EMAC_CLK_EXT_IN;
    emac.clock_config.rmii.clock_gpio = (emac_rmii_clock_gpio_t)EMAC_CLK_IN_GPIO;
#endif
    esp_eth_mac_t *mac = esp_eth_mac_new_esp32(&emac, &mac_cfg);

    eth_phy_config_t phy_cfg = ETH_PHY_DEFAULT_CONFIG();
    phy_cfg.phy_addr = 1;
    phy_cfg.reset_gpio_num = -1;
#if ESPM_ETH_PHY_LAN8720
    esp_eth_phy_t *phy = esp_eth_phy_new_lan87xx(&phy_cfg);
#elif ESPM_ETH_PHY_IP101
    esp_eth_phy_t *phy = esp_eth_phy_new_ip101(&phy_cfg);
#else
    esp_eth_phy_t *phy = esp_eth_phy_new_rtl8201(&phy_cfg);
#endif
    esp_eth_config_t cfg = ETH_DEFAULT_CONFIG(mac, phy);
    if (esp_eth_driver_install(&cfg, &s_eth) != ESP_OK) {
        ESP_LOGE(TAG, "Ethernet driver failed – check the PHY settings of the board");
        return;
    }
    esp_netif_attach(netif, esp_eth_new_netif_glue(s_eth));
    esp_event_handler_register(ETH_EVENT, ESP_EVENT_ANY_ID, on_event, nullptr);
    esp_eth_start(s_eth);
}

#if ESPM_HTTP
static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "link", s_link);
    eth_speed_t speed = ETH_SPEED_10M;
    eth_duplex_t duplex = ETH_DUPLEX_HALF;
    if (s_eth) {
        esp_eth_ioctl(s_eth, ETH_CMD_G_SPEED, &speed);
        esp_eth_ioctl(s_eth, ETH_CMD_G_DUPLEX_MODE, &duplex);
    }
    cJSON_AddNumberToObject(json, "speed", speed == ETH_SPEED_100M ? 100 : 10);
    cJSON_AddStringToObject(json, "duplex", duplex == ETH_DUPLEX_FULL ? "full" : "half");
    cJSON_AddStringToObject(json, "ip", espm_ip());
    return espm_send_json(req, json);
}

struct EthRoutes {
    EthRoutes() { espm_route(HTTP_GET, "/api/v1/ethernet", status); }
};
static EthRoutes s_routes;
#endif
