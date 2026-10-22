import { defineService, Registry } from '../../services';
import type { ConfiguratorEditor, ConfiguratorTab, FlashMethod } from '../../configurator';
import type { Contribution, PartDef, Wire } from '../../types';

// The services of every chip (no `feature`: always there). Framework: `../../services.ts`.

// ---------------------------------------------------------------------------------------------
// On the device
// ---------------------------------------------------------------------------------------------

/**
 * The firmware: sdkconfig, sources, code hooks … of each feature, in hook order. Called only for
 * valid configurations, when the project is generated.
 */
export const firmware = defineService('firmware', () => new Registry<() => Contribution>());

/** Wires between this chip and other chips or parts (shown in the wiring diagram). */
export const wires = defineService('wires', () => new Registry<Wire>());

/** External parts the feature's wires go to (level converters, appliance connectors …). */
export const parts = defineService('parts', () => new Registry<PartDef>());

// ---------------------------------------------------------------------------------------------
// In the configurator (`../../configurator.ts`)
// ---------------------------------------------------------------------------------------------

/** The editor of a feature's settings in the configurator (one per feature, `<feature>/configurator/Editor.svelte`). */
export const configuratorEditors = defineService(
	'configuratorEditors',
	() => new Registry<ConfiguratorEditor>()
);

/** Tabs of the configurator next to Compose and Wire, e.g. the HTTP server's API docs. */
export const configuratorTabs = defineService(
	'configuratorTabs',
	() => new Registry<ConfiguratorTab>()
);

/** Ways to install a finished build besides USB, e.g. OTA. */
export const flashMethods = defineService('flashMethods', () => new Registry<FlashMethod>());
