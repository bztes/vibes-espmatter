#pragma once
#include <stdint.h>

enum espm_sht_model_t { ESPM_SHT4X, ESPM_SHT3X };

struct espm_climate_cfg_t {
    const char *uid;
    const char *name;
    espm_sht_model_t model;
    uint8_t address;
    int sda;
    int scl;
    int interval_s;
    float offset;
};

void espm_climate_add(const espm_climate_cfg_t &cfg);
