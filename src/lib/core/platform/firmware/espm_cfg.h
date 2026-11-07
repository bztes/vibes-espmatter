// espmatter studio – the device configuration: identity, network and per-device settings, read
// from the `espm_cfg` NVS partition the app writes (USB flashing, or pulled from the app). One firmware
// serves many devices; everything that differs between them is in here.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <esp_err.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Load the partition into RAM (called first in app_main; lookups load it on demand too). */
void espm_cfg_init(void);
/** The partition holds a configuration. Without one, every value is its fallback. */
bool espm_cfg_loaded(void);

/** A value of namespace `ns`, or `fallback`. Strings stay valid until restart. */
const char *espm_cfg_str(const char *ns, const char *key, const char *fallback);
int espm_cfg_int(const char *ns, const char *key, int fallback);
double espm_cfg_num(const char *ns, const char *key, double fallback);
bool espm_cfg_bool(const char *ns, const char *key, bool fallback);

/** The configured hostname, else the device name as one: lowercase letters, digits and dashes. */
const char *espm_hostname(void);

/** Size of the configuration partition (images must have exactly this size), 0 if none. */
size_t espm_cfg_size(void);
/** Replace the configuration with an image of the app. Restart afterwards. */
esp_err_t espm_cfg_write(const uint8_t *image, size_t len);

#ifdef __cplusplus
}
#endif
