// espmatter studio – the wall clock: SNTP, shared by every plugin that needs the real time.
#include "espm.h"

#include <stdlib.h>
#include <time.h>
#include <esp_log.h>
#include <esp_netif_sntp.h>

static const char *TAG = "espm_time";
static bool s_started;

void espm_time_sync(const char *server)
{
    // esp_netif_sntp_init may only run once: the first plugin's server wins.
    if (s_started || !server || !server[0]) return;
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(server);
    if (esp_netif_sntp_init(&cfg) != ESP_OK) {
        ESP_LOGW(TAG, "SNTP could not be started");
        return;
    }
    s_started = true;
    ESP_LOGI(TAG, "Time from %s", server);
}

bool espm_time_valid() { return time(nullptr) > 1700000000; } // after 2023-11: SNTP has answered

void espm_time_zone(const char *posix)
{
    setenv("TZ", posix && posix[0] ? posix : "UTC0", 1);
    tzset();
}
