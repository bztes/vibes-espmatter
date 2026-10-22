<!-- OpenTelemetry: how sending metrics and logs goes, and changing their settings (admins). -->
<script lang="ts">
	import { api, errorMessage, fmtAgo } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import {
		Alert,
		Button,
		Checkbox,
		DataList,
		Dialog,
		Input,
		PasswordInput,
		Select,
		StatusDot,
		Switch
	} from '../../../device-ui/ui';

	interface OtelSettings {
		enabled: boolean;
		endpoint: string;
		/** The header itself is never sent back. */
		authSet: boolean;
		metrics: boolean;
		interval: number;
		system: boolean;
		logs: boolean;
		logLevel: 'error' | 'warn' | 'info';
		logInterval: number;
		status: {
			/** Of the metrics. */
			state: 'off' | 'clock' | 'wifi' | 'ok' | 'error';
			error: string;
			/** Wi-Fi is connected. */
			online: boolean;
			/** Unix seconds of the last accepted push, 0 = none since boot. */
			lastOk: number;
			logsError: string;
			logsLastOk: number;
			/** Log lines not sent yet, and lost because the log buffer was full. */
			logsWaiting: number;
			logsDropped: number;
		};
	}

	const otel = live<OtelSettings>('/api/otel', 5_000);

	let dialog = $state<Dialog>();
	/** The settings dialog is open (its errors show there, not in the panel). */
	let editing = $state(false);
	let endpoint = $state('');
	let metrics = $state(true);
	let interval = $state(60);
	let system = $state(true);
	let logs = $state(false);
	let logLevel = $state<OtelSettings['logLevel']>('warn');
	let logInterval = $state(0);
	/** Undefined: keep the stored header. */
	let auth = $state<string>();
	let error = $state('');
	let busy = $state(false);

	function edit() {
		const s = otel.data;
		if (!s) return;
		endpoint = s.endpoint;
		metrics = s.metrics;
		interval = s.interval;
		system = s.system;
		logs = s.logs;
		logLevel = s.logLevel;
		logInterval = s.logInterval;
		auth = undefined;
		error = '';
		editing = true;
		dialog?.open();
	}

	async function send(body: Record<string, string | number | boolean | undefined>) {
		busy = true;
		error = '';
		try {
			await api('/api/otel', { body });
			await otel.refresh();
			return true;
		} catch (e) {
			error = errorMessage(e);
			return false;
		} finally {
			busy = false;
		}
	}

	async function save(ev: SubmitEvent) {
		ev.preventDefault();
		// Keeps sending on or off – except that the first endpoint switches it on.
		const enabled = !!endpoint && (!!otel.data?.enabled || !otel.data?.endpoint);
		const body = {
			endpoint,
			metrics,
			interval,
			system,
			logs,
			logLevel,
			logInterval,
			auth,
			enabled
		};
		if (await send(body)) dialog?.close();
	}

	const STATE = {
		off: { tone: 'muted', text: 'Off' },
		clock: { tone: 'warn', text: 'Waiting for the time (NTP)' },
		wifi: { tone: 'warn', text: 'Waiting for Wi-Fi' },
		ok: { tone: 'ok', text: 'Sending' },
		error: { tone: 'err', text: 'Not sending' }
	} as const;
	/** The logs have no state of their own: derived from the last push. */
	function logsState(s: OtelSettings) {
		if (!s.enabled || !s.logs) return STATE.off;
		if (s.status.state === 'clock') return STATE.clock;
		if (!s.status.online) return STATE.wifi;
		if (s.status.logsError) return STATE.error;
		if (s.status.logsLastOk) return STATE.ok;
		return { tone: 'warn', text: 'Not sent yet' } as const;
	}
	const LEVEL = { error: 'Errors', warn: 'Warnings and errors', info: 'Everything (info)' };
	const ago = (unix: number) => fmtAgo(Math.max(0, Math.round(Date.now() / 1000 - unix)));
</script>

<Panel title="OpenTelemetry">
	{#snippet badge()}
		{#if otel.data}
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="link" onclick={edit}>Change</Button>
				<Switch
					checked={otel.data.enabled}
					disabled={busy || !otel.data.endpoint}
					title={otel.data.endpoint ? 'Send' : 'Set the endpoint first'}
					aria-label="Send"
					onchange={(e) => send({ enabled: e.currentTarget.checked })}
				/>
			</div>
		{/if}
	{/snippet}

	{#if otel.data}
		{@const s = otel.data}
		{@const mst = s.enabled && s.metrics ? STATE[s.status.state] : STATE.off}
		{@const lst = logsState(s)}
		<DataList>
			<dt>Endpoint</dt>
			<dd class="font-mono text-xs wrap-anywhere">{s.endpoint || '–'}</dd>
		</DataList>

		<!-- Metrics and logs side by side, stacked when the panel is narrow. -->
		<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
			<section class="grid min-w-0 content-start gap-2 rounded-lg border px-3 pt-2.5 pb-3">
				<div class="flex items-center justify-between gap-2.5">
					<h3 class="m-0 text-sm">Metrics</h3>
					<span>
						<Switch
							checked={s.metrics}
							disabled={busy || (s.metrics && !s.logs)}
							title={s.metrics && !s.logs ? 'Logs are off – switch them on first' : 'Send metrics'}
							aria-label="Send metrics"
							onchange={(e) => send({ metrics: e.currentTarget.checked })}
						/>
					</span>
				</div>
				<StatusDot tone={mst.tone} label={mst.text} />
				{#if s.metrics}
					{#if s.enabled && s.status.error}<p class="m-0 text-err">{s.status.error}</p>{/if}
					<DataList>
						<dt>Every</dt>
						<dd>{s.interval} s{s.system ? ' · with device metrics' : ''}</dd>
						<dt>Last sent</dt>
						<dd>{s.status.lastOk ? `${ago(s.status.lastOk)} ago` : 'not since the restart'}</dd>
					</DataList>
				{/if}
			</section>

			<section class="grid min-w-0 content-start gap-2 rounded-lg border px-3 pt-2.5 pb-3">
				<div class="flex items-center justify-between gap-2.5">
					<h3 class="m-0 text-sm">Logs</h3>
					<span>
						<Switch
							checked={s.logs}
							disabled={busy || (s.logs && !s.metrics)}
							title={s.logs && !s.metrics ? 'Metrics are off – switch them on first' : 'Send logs'}
							aria-label="Send logs"
							onchange={(e) => send({ logs: e.currentTarget.checked })}
						/>
					</span>
				</div>
				<StatusDot tone={lst.tone} label={lst.text} />
				{#if s.logs}
					{#if s.enabled && s.status.logsError}<p class="m-0 text-err">{s.status.logsError}</p>{/if}
					<DataList>
						<dt>Level</dt>
						<dd>{LEVEL[s.logLevel]}</dd>
						<dt>Every</dt>
						<dd>
							{#if s.logInterval}
								{s.logInterval} s <span class="text-muted">· errors right away</span>
							{:else}
								right away
							{/if}
						</dd>
						<dt>Last sent</dt>
						<dd>
							{s.status.logsLastOk ? `${ago(s.status.logsLastOk)} ago` : 'not since the restart'}
						</dd>
						<dt>Waiting</dt>
						<dd>
							{s.status.logsWaiting ? `${s.status.logsWaiting} lines` : 'nothing'}
							{#if s.status.logsDropped}
								<span class="text-muted">· {s.status.logsDropped} lost (buffer full)</span>
							{/if}
						</dd>
					</DataList>
				{/if}
			</section>
		</div>
		{#if error && !editing}<Alert>{error}</Alert>{/if}
	{:else if otel.error}
		<p class="text-err">{otel.error}</p>
	{:else}
		<p class="text-muted">Loading…</p>
	{/if}
</Panel>

<Dialog bind:this={dialog} width={600} onclose={() => (editing = false)}>
	<form class="grid gap-2 [&_label]:m-0" onsubmit={save}>
		<h2 class="m-0 text-md">OpenTelemetry settings</h2>
		<Input
			label="OTLP endpoint (/v1/metrics and /v1/logs are added)"
			type="url"
			bind:value={endpoint}
			pattern="https?://\S+"
			maxlength={200}
			placeholder="http://collector.local:4318"
			autocomplete="off"
		/>
		{#if auth === undefined}
			<div class="flex items-baseline gap-2 text-sm">
				<span class="text-muted">
					Authorization header: {otel.data?.authSet ? 'set' : 'none'}
				</span>
				<Button variant="link" onclick={() => (auth = '')}>
					{otel.data?.authSet ? 'Change' : 'Add'}
				</Button>
			</div>
		{:else}
			<PasswordInput
				label="Authorization header (empty: none)"
				bind:value={auth}
				maxlength={256}
				placeholder="Basic … / Bearer … / API key"
				autocomplete="off"
			/>
		{/if}

		<div class="mt-1 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
			<fieldset class="m-0 grid min-w-0 content-start gap-2 rounded-lg border px-3 pt-2.5 pb-3">
				<legend class="px-1 font-semibold"
					><Checkbox bind:checked={metrics}>Metrics</Checkbox></legend
				>
				{#if metrics}
					<Input
						label="Send every (seconds)"
						type="number"
						bind:value={interval}
						min={10}
						max={3600}
						required
					/>
					<Checkbox bind:checked={system}>Device metrics (uptime, memory, Wi-Fi signal)</Checkbox>
				{/if}
			</fieldset>
			<fieldset class="m-0 grid min-w-0 content-start gap-2 rounded-lg border px-3 pt-2.5 pb-3">
				<legend class="px-1 font-semibold"><Checkbox bind:checked={logs}>Logs</Checkbox></legend>
				{#if logs}
					<Select label="Level" bind:value={logLevel}>
						<option value="error">Errors</option>
						<option value="warn">Warnings and errors</option>
						<option value="info">Everything (info)</option>
					</Select>
					<Input
						label="Send every (seconds, 0 = right away)"
						type="number"
						bind:value={logInterval}
						min={0}
						max={3600}
						required
					/>
				{/if}
			</fieldset>
		</div>

		{#if error}<Alert>{error}</Alert>{/if}
		<div class="flex flex-wrap items-center gap-2 justify-end">
			<Button onclick={() => dialog?.close()}>Cancel</Button>
			<Button type="submit" variant="primary" disabled={busy}>Save</Button>
		</div>
	</form>
</Dialog>
