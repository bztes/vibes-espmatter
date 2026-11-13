<!-- A place where other plugins put components (`out.spot()`); each gets `context` as props. -->
<script lang="ts" generics="S extends SpotName">
	import { itemsFor, type SpotName, type Spots } from './spots.svelte';

	let { name, context }: { name: S; context: Spots[S] } = $props();
</script>

{#each itemsFor(name) as item, i (i)}
	<item.component {...context} />
{/each}
