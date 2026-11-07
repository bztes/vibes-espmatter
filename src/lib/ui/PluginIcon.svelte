<script lang="ts" module>
	import Activity from '@lucide/svelte/icons/activity';
	import Cable from '@lucide/svelte/icons/cable';
	import Cpu from '@lucide/svelte/icons/cpu';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Heater from '@lucide/svelte/icons/heater';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Network from '@lucide/svelte/icons/network';
	import Power from '@lucide/svelte/icons/power';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import RadioTower from '@lucide/svelte/icons/radio-tower';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Settings from '@lucide/svelte/icons/settings';
	import Thermometer from '@lucide/svelte/icons/thermometer';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import Wifi from '@lucide/svelte/icons/wifi';
	import type { Component } from 'svelte';

	/** Icons plugins may name (`icon: 'wifi'`); unknown names show a puzzle piece. Add new ones here. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ICONS: Record<string, Component<any>> = {
		activity: Activity,
		cable: Cable,
		cpu: Cpu,
		'door-open': DoorOpen,
		heater: Heater,
		'layout-dashboard': LayoutDashboard,
		lightbulb: Lightbulb,
		network: Network,
		power: Power,
		'radio-tower': RadioTower,
		'refresh-cw': RefreshCw,
		settings: Settings,
		thermometer: Thermometer,
		waypoints: Waypoints,
		wifi: Wifi
	};
</script>

<script lang="ts">
	let {
		name,
		size = 18,
		class: className
	}: { name?: string; size?: number; class?: string } = $props();
	const Icon = $derived((name && ICONS[name]) || Puzzle);
</script>

<Icon {size} class={className} />
