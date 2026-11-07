<script lang="ts">
	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		step = 1,
		label,
		unit = '',
		disabled = false,
		onchange
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		label: string;
		unit?: string;
		disabled?: boolean;
		onchange?: (value: number) => void;
	} = $props();
</script>

<label class="grid gap-1.5 text-sm">
	<span class="flex justify-between"
		><span class="text-muted">{label}</span><span class="font-medium tabular-nums"
			>{value}{unit}</span
		></span
	>
	<input
		type="range"
		class="w-full accent-accent"
		{min}
		{max}
		{step}
		{disabled}
		bind:value
		onchange={() => onchange?.(value)}
	/>
</label>
