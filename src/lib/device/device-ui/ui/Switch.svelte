<!-- On/off toggle: a checkbox with `role="switch"`, its ::before is the knob. Give it an `aria-label`. -->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	let { checked = $bindable(false), ...rest }: Omit<HTMLInputAttributes, 'type'> = $props();
</script>

<input
	type="checkbox"
	role="switch"
	class="relative m-0 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-border p-0 transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
	bind:checked
	{...rest}
/>
