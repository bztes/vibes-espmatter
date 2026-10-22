<!-- An on/off setting, across the whole row of `Fields`. -->
<script lang="ts">
	import { Checkbox } from '#lib/device/device-ui/ui/index.ts';
	import Help from './Help.svelte';

	let {
		checked = $bindable(),
		label,
		help
	}: { checked: boolean; label: string; help?: string } = $props();
</script>

<div class="col-span-full flex items-center gap-1.5">
	<Checkbox bind:checked>{label}</Checkbox>
	<Help text={help} />
</div>
