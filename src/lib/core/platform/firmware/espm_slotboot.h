// espmatter studio – on a board the main board flashes over a wire (SlotDef.flashOverWire).
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Watch the trigger line (ESPM_SLOTBOOT_TRIGGER, pulled up): held low by the main board, the board
 * restarts into the ROM's serial download mode, where the main board flashes it over UART0.
 */
void espm_slotboot_start(void);

#ifdef __cplusplus
}
#endif
