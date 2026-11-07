#pragma once

struct espm_contact_cfg_t {
    const char *uid;
    const char *name;
    int gpio;
    bool invert;
    int debounce_ms;
};

void espm_contact_add(const espm_contact_cfg_t &cfg);
