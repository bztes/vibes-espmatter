// espmatter studio – Wi-Fi station: credentials from the device configuration, REST status/scan/switch.
#include "espm.h"

#include <string.h>
#include <string>
#include <esp_log.h>
#include <esp_netif.h>
#include <esp_wifi.h>
#include <platform/CHIPDeviceLayer.h>

static const char *TAG = "espm_wifi";

static void apply(const char *ssid, const char *password)
{
    wifi_config_t cfg = {};
    strlcpy((char *)cfg.sta.ssid, ssid, sizeof(cfg.sta.ssid));
    strlcpy((char *)cfg.sta.password, password, sizeof(cfg.sta.password));
    cfg.sta.threshold.authmode = password[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    esp_wifi_set_config(WIFI_IF_STA, &cfg);
    esp_wifi_disconnect();
    esp_wifi_connect();
}

void espm_wifi_start()
{
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (netif) esp_netif_set_hostname(netif, espm_hostname());
    esp_wifi_set_ps(ESPM_WIFI_PS_NONE ? WIFI_PS_NONE : WIFI_PS_MIN_MODEM);

    wifi_config_t current = {};
    esp_wifi_get_config(WIFI_IF_STA, &current);
    if (ESPM_WIFI_SSID[0] && !current.sta.ssid[0]) {
        // Not provisioned yet: use the network from the configuration.
        ESP_LOGI(TAG, "Connecting to %s", ESPM_WIFI_SSID);
        apply(ESPM_WIFI_SSID, ESPM_WIFI_PASSWORD);
        chip::DeviceLayer::ConnectivityMgr().SetWiFiStationMode(
            chip::DeviceLayer::ConnectivityManager::kWiFiStationMode_Enabled);
    }
}

#if ESPM_HTTP
static esp_err_t status(httpd_req_t *req)
{
    cJSON *json = cJSON_CreateObject();
    wifi_ap_record_t ap;
    bool connected = esp_wifi_sta_get_ap_info(&ap) == ESP_OK;
    cJSON_AddBoolToObject(json, "connected", connected);
    if (connected) {
        cJSON_AddStringToObject(json, "ssid", (const char *)ap.ssid);
        cJSON_AddNumberToObject(json, "rssi", ap.rssi);
        cJSON_AddNumberToObject(json, "channel", ap.primary);
    }
    cJSON_AddStringToObject(json, "ip", espm_ip());
    uint8_t mac[6];
    char mac_s[18];
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    snprintf(mac_s, sizeof(mac_s), "%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    cJSON_AddStringToObject(json, "mac", mac_s);
    return espm_send_json(req, json);
}

static esp_err_t scan(httpd_req_t *req)
{
    wifi_scan_config_t cfg = {};
    if (esp_wifi_scan_start(&cfg, true) != ESP_OK) return espm_send_error(req, 503, "scan failed");
    uint16_t count = 20;
    wifi_ap_record_t records[20];
    esp_wifi_scan_get_ap_records(&count, records);
    cJSON *json = cJSON_CreateObject();
    cJSON *list = cJSON_AddArrayToObject(json, "networks");
    for (int i = 0; i < count; i++) {
        if (!records[i].ssid[0]) continue;
        cJSON *n = cJSON_CreateObject();
        cJSON_AddStringToObject(n, "ssid", (const char *)records[i].ssid);
        cJSON_AddNumberToObject(n, "rssi", records[i].rssi);
        cJSON_AddNumberToObject(n, "channel", records[i].primary);
        cJSON_AddBoolToObject(n, "secure", records[i].authmode != WIFI_AUTH_OPEN);
        cJSON_AddItemToArray(list, n);
    }
    return espm_send_json(req, json);
}

static esp_err_t change(httpd_req_t *req)
{
    cJSON *body = espm_read_json(req);
    if (!body) return ESP_FAIL;
    cJSON *ssid = cJSON_GetObjectItem(body, "ssid");
    cJSON *password = cJSON_GetObjectItem(body, "password");
    if (!cJSON_IsString(ssid) || !ssid->valuestring[0] || strlen(ssid->valuestring) > 32) {
        cJSON_Delete(body);
        return espm_send_error(req, 400, "ssid is required");
    }
    std::string s = ssid->valuestring, p = cJSON_IsString(password) ? password->valuestring : "";
    cJSON_Delete(body);
    espm_send_ok(req);
    apply(s.c_str(), p.c_str());
    return ESP_OK;
}

struct WifiRoutes {
    WifiRoutes()
    {
        espm_route(HTTP_GET, "/api/v1/wifi", status);
        espm_route(HTTP_GET, "/api/v1/wifi/scan", scan);
        espm_route(HTTP_POST, "/api/v1/wifi", change);
    }
};
static WifiRoutes s_routes;
#endif
