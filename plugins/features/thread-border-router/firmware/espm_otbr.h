#pragma once
#include <stddef.h>
#include <stdint.h>

void espm_otbr_start();
/** The active operational dataset (TLVs) into buf; its length, 0 without a running Thread network. */
size_t espm_otbr_dataset(uint8_t *buf, size_t size);
