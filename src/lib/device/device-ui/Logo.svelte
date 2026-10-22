<!--
	The vibes-espmatter logo, in the headers of the website and of the device web interface (and as
	`src/lib/assets/favicon.svg`). Lives here because the device UI can only import from
	`src/lib/device/`.
-->
<script lang="ts">
	let { size = 24, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	class={['shrink-0 text-accent', className]}
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	aria-hidden="true"
>
	<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" />
	<circle cx="12" cy="11" r="3" />
</svg>
