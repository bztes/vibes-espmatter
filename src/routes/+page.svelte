<script lang="ts">
	import { resolve } from '$app/paths';
	import { deleteProject, listProjects } from '#lib/api/projects.remote.ts';
	import { Button, Panel, showConfirm } from '#lib/device/device-ui/ui/index.ts';
	import { boards, features, templates } from '#lib/device/registry.ts';
	import DeviceAddress from '#lib/components/DeviceAddress.svelte';
	import NewDevice from '#lib/components/NewDevice.svelte';

	const projects = $derived(await listProjects());

	async function remove(id: string, name: string) {
		const ok = await showConfirm(
			'Delete device',
			`Delete “${name}”? Builds stay available via their links.`,
			{
				action: 'Delete',
				danger: true
			}
		);
		if (!ok) return;
		await deleteProject(id);
	}

	const featureNames = (ids: string[]) =>
		ids
			.filter((id) => !features.find(id)?.always)
			.map((id) => features.find(id)?.name ?? id)
			.sort((a, b) => a.localeCompare(b))
			.join(', ') || 'no features';
</script>

<svelte:head>
	<title>vibes-espmatter</title>
</svelte:head>

<div class="mx-auto px-4 py-6 max-w-[1024px]">
	<h1 class="mt-0 mb-4 text-xl">My devices</h1>

	{#if projects.length === 0}
		<Panel flush class="p-8 text-center"
			><p class="text-muted">No saved devices yet – start one below.</p></Panel
		>
	{:else}
		<Panel flush class="px-4"
			><ul class="m-0 list-none p-0">
				{#each projects as p (p.id)}
					<li class="flex flex-wrap items-center gap-3 py-3.5 not-first:border-t">
						<div class="min-w-0 flex-1">
							<a
								class="font-semibold text-fg no-underline hover:underline"
								href={resolve('/device/[id]', { id: p.id })}>{p.name}</a
							>
							<span class="text-muted"
								>· {(p.template && templates.find(p.template)?.name) || 'Custom device'}</span
							>
							<ul class="my-1 list-none p-0 text-sm text-muted">
								{#each p.chips as chip, i (i)}
									<li>
										<strong class="font-medium text-fg">{chip.name}</strong>
										({boards.find(chip.board)?.name ?? chip.board}): {featureNames(chip.features)}
									</li>
								{/each}
							</ul>
							<DeviceAddress projectId={p.id} address={p.lastAddress} lastSeenAt={p.lastSeenAt} />
						</div>
						<span class="text-xs text-muted">{p.updatedAt.toLocaleString()}</span>
						<Button href={resolve('/device/[id]', { id: p.id })}>Open</Button>
						<Button variant="danger" onclick={() => remove(p.id, p.name)}>Delete</Button>
					</li>
				{/each}
			</ul></Panel
		>
	{/if}

	<h2 class="mt-8 mb-4 text-lg">New device</h2>
	<NewDevice />
</div>
