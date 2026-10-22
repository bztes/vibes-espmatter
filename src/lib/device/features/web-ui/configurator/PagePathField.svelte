<!-- The "Path" setting of a page (`checkPagePath`), for the dashboards' settings. -->
<script lang="ts">
	import { TextField } from '#lib/components/config/index.ts';

	let { value = $bindable(), error }: { value: string; error?: string } = $props();
</script>

<TextField
	label="Path"
	help="Where the page is served, e.g. / or /admin. Lowercase letters, digits and -."
	maxlength={32}
	{error}
	bind:value
/>
