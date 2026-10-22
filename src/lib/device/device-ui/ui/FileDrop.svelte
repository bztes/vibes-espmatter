<!-- Pick a file by clicking or dropping it; `onpick` gets it. Shows the chosen file. -->
<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload';
	import { tv } from 'tailwind-variants/lite';

	const drop = tv({
		base: 'relative m-0 grid cursor-pointer justify-items-center gap-0.5 rounded-xl border-[1.5px] bg-bg px-3 py-[18px] text-center transition-colors',
		variants: {
			dragging: {
				true: 'border-accent text-accent',
				false: 'text-muted hover:border-accent hover:text-accent'
			},
			chosen: { true: 'border-solid', false: 'border-dashed' }
		}
	});

	let {
		file,
		accept,
		disabled = false,
		label = 'Choose a file',
		onpick
	}: {
		/** The chosen file (shown instead of `label`). */
		file?: File | null;
		accept?: string;
		disabled?: boolean;
		label?: string;
		onpick: (file: File | undefined) => void;
	} = $props();

	let dragging = $state(false);

	const size = (bytes: number) =>
		bytes > 1024 * 1024
			? `${(bytes / 1024 / 1024).toFixed(2)} MB`
			: `${Math.round(bytes / 1024)} KB`;
</script>

<label
	class={drop({ dragging, chosen: !!file })}
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		onpick(e.dataTransfer?.files[0]);
	}}
>
	<!-- The native control stays for keyboard/screen readers, but invisible over the drop zone. -->
	<input
		type="file"
		class="absolute inset-0 cursor-pointer opacity-0"
		{accept}
		{disabled}
		onchange={(e) => onpick(e.currentTarget.files?.[0])}
	/>
	<Upload size={26} />
	{#if file}
		<strong class="text-fg wrap-anywhere">{file.name}</strong>
		<small class="text-xs">{size(file.size)}</small>
	{:else}
		<strong class="text-fg wrap-anywhere">{label}</strong>
		<small class="text-xs">or drop it here</small>
	{/if}
</label>
