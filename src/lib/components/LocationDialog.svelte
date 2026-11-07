<!-- Adds or edits a location (Home, Parents, …). -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createLocation, deleteLocation, updateLocation } from '#lib/remote/locations.remote.ts';
	import { Button, Dialog, Field, Input } from '#lib/ui/index.ts';

	type Location = { id: string; name: string };

	let {
		open = $bindable(false),
		location,
		onsaved,
		ondeleted
	}: {
		open?: boolean;
		/** Edit this one; none: add a new location. */
		location?: Location;
		onsaved?: (id: string) => void;
		ondeleted?: () => void;
	} = $props();

	let name = $state(untrack(() => location?.name ?? ''));
	let error = $state('');
	let busy = $state(false);
	let confirmDelete = $state(false);

	async function run(fn: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await fn();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		void run(async () => {
			const fields = { name };
			const id = location
				? (await updateLocation({ id: location.id, ...fields }), location.id)
				: (await createLocation(fields)).id;
			open = false;
			onsaved?.(id);
		});
	}
</script>

<Dialog bind:open title={location ? `Edit ${location.name}` : 'New location'}>
	<form id="location-form" class="grid gap-4" onsubmit={save}>
		<Field
			label="Name"
			id="location-name"
			help="e.g. Home, Parents, Office."
			error={error || undefined}
		>
			<Input id="location-name" maxlength={32} placeholder="Home" bind:value={name} autofocus />
		</Field>
	</form>
	{#snippet footer()}
		{#if location}
			<div class="mr-auto flex items-center gap-2">
				{#if !confirmDelete}
					<Button variant="ghost" onclick={() => (confirmDelete = true)}>Delete…</Button>
				{:else}
					<span class="text-xs text-muted">Its devices stay, without a location.</span>
					<Button
						variant="danger"
						disabled={busy}
						onclick={() =>
							run(async () => {
								await deleteLocation(location.id);
								open = false;
								ondeleted?.();
							})}>Delete</Button
					>
				{/if}
			</div>
		{/if}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="location-form" disabled={busy}
			>{location ? 'Save' : 'Add'}</Button
		>
	{/snippet}
</Dialog>
