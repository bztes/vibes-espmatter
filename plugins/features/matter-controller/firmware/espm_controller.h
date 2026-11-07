#pragma once
#include <stdint.h>

void espm_controller_start();

/** What a button of a Generic Switch did. Stored in automation rules – keep the values. */
enum espm_button_t : uint8_t { ESPM_BUTTON_PRESS = 1, ESPM_BUTTON_DOUBLE = 2, ESPM_BUTTON_HOLD = 3 };

// Lookups of paired nodes – Matter task (stack lock held).
/** The Switch cluster's FeatureMap of a node's endpoint, 0 if unknown. */
uint32_t espm_controller_switch_features(uint64_t node, uint16_t endpoint);
/** The node is paired and has this endpoint. */
bool espm_controller_has_endpoint(uint64_t node, uint16_t endpoint);
/** A followed attribute by its API key (`on`, `level`, `colorTemperature` …) while the node is online. */
bool espm_controller_value(uint64_t node, uint16_t endpoint, const char *key, float *out);

// Defined by espm_automations.cpp when the firmware has automations (weak: optional).
/** A button gesture; `release`: a held button was let go. Matter task (stack lock held). */
__attribute__((weak)) void espm_automations_button(uint64_t node, uint16_t endpoint, espm_button_t button,
                                                   bool release);
/** A followed attribute reported a (non-null) value, by its API key. Matter task (stack lock held). */
__attribute__((weak)) void espm_automations_value(uint64_t node, uint16_t endpoint, const char *key, float value);
/** A node left the fabric: drop what refers to it. Stack lock held. */
__attribute__((weak)) void espm_automations_node_removed(uint64_t node);
void espm_automations_start();
