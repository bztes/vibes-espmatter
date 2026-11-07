<script lang="ts">
	import { api, Badge, Button, CodeBlock, errorText, Notice, Poll, Row } from '#sdk/device-ui';

	interface Thread {
		rcp: string;
		role?: string;
		networkName?: string;
		channel?: number;
		panId?: string;
		routers?: number;
		children?: number;
	}
	const thread = new Poll<Thread>('/api/v1/thread', 5000);
	let dataset = $state('');
	let error = $state('');

	async function showDataset() {
		try {
			dataset = (await api<{ tlvs: string }>('/api/v1/thread/dataset')).tlvs;
		} catch (e) {
			error = errorText(e);
		}
	}
</script>

{#if thread.current}
	{@const t = thread.current}
	{#if t.rcp === 'starting'}
		<Notice>Starting the radio board – this can take a minute after the hub restarts.</Notice>
	{:else if t.rcp === 'updating'}
		<Notice>Installing an update on the radio board – Thread is paused until it’s back.</Notice>
	{:else if t.rcp !== 'ok'}
		<Notice tone="err"
			>The radio board doesn’t answer – check the UART wiring and that it is flashed.</Notice
		>
	{:else}
		<Row label="Role"
			><Badge tone={t.role === 'leader' || t.role === 'router' ? 'ok' : 'warn'}>{t.role}</Badge
			></Row
		>
		<Row label="Network">{t.networkName}</Row>
		<Row label="Channel / PAN">{t.channel} · <span class="font-mono">{t.panId}</span></Row>
		<Row label="Routers / devices">{t.routers} / {t.children}</Row>
		<Button size="sm" class="mt-3" onclick={showDataset}>Show dataset</Button>
		{#if dataset}<CodeBlock wrap class="mt-2 p-2">{dataset}</CodeBlock>{/if}
	{/if}
{/if}
{#if error}<p class="mt-2 text-sm text-err">{error}</p>{/if}
