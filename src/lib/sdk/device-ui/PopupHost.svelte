<!-- The page's one popup (`openPopup()`), rendered once at the root; closes when the route changes. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import Dialog from './Dialog.svelte';
	import { popup } from './popup.svelte';
	import { route } from './route.svelte';

	const shown = $derived(popup.current);

	$effect(() => {
		void route.path;
		void route.query.toString();
		untrack(() => popup.close());
	});
</script>

{#if shown}
	<Dialog bind:open={() => true, () => popup.close()} title={shown.title} wide={shown.wide}>
		<shown.component {...shown.props} />
	</Dialog>
{/if}
