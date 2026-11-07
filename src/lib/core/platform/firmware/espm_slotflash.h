// espmatter studio – the main board flashes boards wired to it (SlotDef.flashOverWire).
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** A board the main board flashes – the generated espm_slots.c lists them. */
typedef struct {
    const char *id;
    const char *name;
    const char *chip;
    /** Main board GPIOs: UART to the board's UART0, and the trigger line to it. */
    int tx;
    int rx;
    int trigger;
    uint32_t flash_size;
    /** The board's "force download boot" flag, cleared before it is rebooted. */
    uint32_t force_reg;
    uint32_t force_mask;
    /** Where its app goes, and the most it may be. */
    uint32_t app_offset;
    uint32_t app_max;
} espm_slot_t;

extern const espm_slot_t espm_slots[];
extern const int espm_slot_count;

/**
 * Once online: ask the app for each board's update and install it over the wires, then let the
 * plugins use them (espm_slot_wait). Adds GET /api/v1/slots.
 */
void espm_slotflash_start(void);

#ifdef __cplusplus
}
#endif
