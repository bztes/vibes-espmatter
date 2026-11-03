<script lang="ts">
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Button, Input, PasswordInput, showAlert } from '../../../device-ui/ui';

	const settings = live<{ server: string; hasToken: boolean }>('/api/updates/server', 60_000);

	let editing = $state(false);
	let server = $state('');
	let token = $state('');

	function edit() {
		server = settings.data?.server ?? '';
		token = '';
		editing = true;
	}

	async function save(ev: SubmitEvent) {
		ev.preventDefault();
		try {
			await api('/api/updates/server', {
				body: { server: server.trim(), ...(token ? { token } : {}) }
			});
			editing = false;
			await settings.refresh();
		} catch (e) {
			showAlert('Saving failed', errorMessage(e));
		}
	}
</script>

<Panel title="Updates from the app">
	<p class="text-muted text-sm">
		Updates started in the vibes-espmatter app: the device checks it every 5 minutes. Set by the
		build – change it only if the app moved.
	</p>
	{#if editing}
		<form class="mt-3 grid gap-2" onsubmit={save}>
			<Input label="App address" bind:value={server} placeholder="https://espmatter.example.com" />
			<PasswordInput
				label="Token (empty: keep the current one)"
				bind:value={token}
				autocomplete="off"
			/>
			<div class="flex gap-2">
				<Button variant="primary" type="submit">Save</Button>
				<Button variant="link" tone="muted" onclick={() => (editing = false)}>Cancel</Button>
			</div>
		</form>
	{:else if settings.data}
		<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
			<span
				>{settings.data.server
					? `${settings.data.server}${settings.data.hasToken ? '' : ' (no token)'}`
					: 'No app address set.'}</span
			>
			<Button variant="link" onclick={edit}>Change</Button>
		</div>
	{:else if settings.error}
		<p class="text-err mt-2 text-sm">{settings.error}</p>
	{/if}
</Panel>
