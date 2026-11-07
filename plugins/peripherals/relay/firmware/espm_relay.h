#pragma once
#include <stdint.h>

struct espm_relay_cfg_t {
    const char *uid;
    const char *name;
    int gpio;
    bool active_low;
    /** 0 off, 1 on, 2 restore last state. */
    int startup;
    /** Local push button to GND, -1: none. */
    int button;
};

void espm_relay_add(const espm_relay_cfg_t &cfg);
