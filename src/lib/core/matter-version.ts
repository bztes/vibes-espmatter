/** Pinned: 1.6 changed the controller and lock APIs the firmware uses. */
export const ESP_MATTER_VERSION = '~1.5.1';

/**
 * connectedhomeip commit of that esp-matter version (its `connectedhomeip/connectedhomeip`
 * submodule), source of `#sdk/matter-model`. Bump both together, then `pnpm gen:matter`.
 */
export const CHIP_COMMIT = 'b87051a95fc110c0cfbac278f232df55c89866de';
