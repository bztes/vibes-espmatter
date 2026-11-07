/**
 * The two kinds of devices. A kind only states rules in terms of capabilities – which feature
 * provides them is up to the plugins.
 */
import type { DeviceKind, HardwareRequirements, Issue } from '#sdk';

export interface KindRuleContext {
	/** Enabled plugins providing a capability. */
	providers(capability: string): string[];
	peripheralCount: number;
}

export interface KindDef {
	id: DeviceKind;
	name: string;
	/** Name of a new device of this kind when none is given. */
	defaultName: string;
	description: string;
	mainSlot: { name: string; requires?: HardwareRequirements };
	/** Default main board of new devices. */
	defaultBoard: string;
	/** Peripherals can be added. */
	peripherals: boolean;
	/**
	 * The firmware is a Matter device (a node others pair). A hub isn't: it's a Matter controller
	 * with its own fabric, and esp-matter can't be both a device and a commissioner.
	 */
	matterDevice: boolean;
	rules(ctx: KindRuleContext): Issue[];
}

export const KINDS: Record<DeviceKind, KindDef> = {
	hub: {
		id: 'hub',
		name: 'Matter hub',
		defaultName: 'ESPMatter Hub',
		description:
			'Controls your Matter devices, runs the Thread network and relays updates to Thread devices.',
		// The Matter controller alone needs ~130 KB of RAM (put in PSRAM, see espm_psram.lf in generate.ts).
		mainSlot: { name: 'Main board', requires: { psram: true } },
		defaultBoard: 'esp32-s3-devkitc-1',
		peripherals: false,
		matterDevice: false,
		rules({ providers }) {
			const issues: Issue[] = [];
			if (!providers('uplink').length)
				issues.push({
					severity: 'error',
					scope: 'device',
					message: 'A hub needs a network uplink: enable Wi-Fi or Ethernet.'
				});
			if (providers('uplink').length > 1)
				issues.push({
					severity: 'info',
					scope: 'device',
					message: `Several uplinks (${providers('uplink').join(', ')}): the first one that connects is used.`
				});
			if (!providers('matter-controller').length)
				issues.push({
					severity: 'warning',
					scope: 'device',
					message: 'Without a Matter controller the hub can not pair or control devices.'
				});
			return issues;
		}
	},
	device: {
		id: 'device',
		name: 'Matter device',
		defaultName: 'Matter device',
		description:
			'A sensor, switch or appliance for your hub, Apple Home, Google Home or Home Assistant.',
		mainSlot: { name: 'Main board', requires: { capabilities: ['ble'] } },
		defaultBoard: 'esp32-c6-devkitc-1',
		peripherals: true,
		matterDevice: true,
		rules({ providers, peripheralCount }) {
			const issues: Issue[] = [];
			const transports = providers('matter-transport');
			if (!transports.length)
				issues.push({
					severity: 'error',
					scope: 'device',
					message: 'Choose how the device connects: enable Wi-Fi or Thread.'
				});
			if (!peripheralCount)
				issues.push({
					severity: 'warning',
					scope: 'device',
					message: 'The device has no peripherals yet – it would pair, but do nothing.'
				});
			return issues;
		}
	}
};
