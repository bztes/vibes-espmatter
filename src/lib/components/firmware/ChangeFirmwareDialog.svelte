<!-- Picking another firmware for a device. -->
<script lang="ts">
	import { boards } from '#lib/core/registry.ts';
	import { setDeviceFirmware, type getDevice } from '#lib/remote/devices.remote.ts';
	import { listFirmwares } from '#lib/remote/firmware.remote.ts';
	import { Badge, Button, Dialog, Notice, Radio, relativeTime } from '#lib/ui/index.ts';

	let {
		open = $bindable(false),
		device,
		onchange
	}: {
		open?: boolean;
		device: Awaited<ReturnType<typeof getDevice>>;
		onchange?: () => void;
	} = $props();

	let picked = $state('');
	let saving = $state(false);
	let error = $state('');

	$effect(() => {
		if (open) {
			picked = device.firmware.id;
			error = '';
		}
	});

	const boardNames = (ids: Record<string, string>) =>
		Object.values(ids)
			.map((id) => boards.find(id)?.name ?? id)
			.join(' + ');

	async function save() {
		error = '';
		saving = true;
		try {
			await setDeviceFirmware({ id: device.id, firmwareId: picked });
			open = false;
			onchange?.();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open title="Change firmware">
	{@const firmwares = (await listFirmwares()).filter((f) => f.kind === device.kind)}
	<div class="grid gap-3">
		{#if error}<Notice tone="err">{error}</Notice>{/if}
		<p class="m-0 text-sm text-muted">
			The device keeps its settings. Another firmware takes effect with its next install.
		</p>
		<div class="grid gap-2" role="radiogroup" aria-label="Firmware">
			{#each firmwares as f (f.id)}
				<label
					class={[
						'flex cursor-pointer items-start gap-3 rounded-xl border p-3',
						picked === f.id ? 'border-accent bg-accent-soft/40' : 'border-border hover:bg-surface-2'
					]}
				>
					<Radio class="mt-1" name="firmware" value={f.id} bind:group={picked} />
					<span class="grid min-w-0 gap-0.5 text-sm">
						<span class="flex flex-wrap items-center gap-2 font-medium"
							>{f.name}
							{#if f.id === device.firmware.id}<Badge>current</Badge>{/if}
							{#if f.errors}<Badge tone="err">{f.errors} error{f.errors > 1 ? 's' : ''}</Badge
								>{/if}</span
						>
						<span class="text-xs text-muted"
							>{boardNames(f.boards)} · {f.devices} device{f.devices === 1 ? '' : 's'} · {f.latestBuild
								? `version ${f.latestBuild.version}, ${relativeTime(f.latestBuild.createdAt)}`
								: 'not built yet'}</span
						>
					</span>
				</label>
			{/each}
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			disabled={saving || !picked || picked === device.firmware.id}
			onclick={save}>{saving ? 'Changing…' : 'Change firmware'}</Button
		>
	{/snippet}
</Dialog>
