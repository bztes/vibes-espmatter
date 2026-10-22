<script lang="ts">
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Button, FileDrop, Progress } from '../../../device-ui/ui';

	let file = $state<File | null>(null);
	let percent = $state<number | null>(null);
	let message = $state('');
	let failed = $state(false);
	const uploading = $derived(percent !== null && percent < 100 && !failed && !message);

	function pick(f: File | null | undefined) {
		message = '';
		failed = false;
		percent = null;
		if (!f) return;
		if (!f.name.endsWith('.bin')) {
			failed = true;
			message = 'Pick the app image (.bin) of a vibes-espmatter build.';
			return;
		}
		file = f;
	}

	function upload() {
		if (!file) return;
		message = '';
		failed = false;
		percent = 0;
		// XHR instead of fetch for upload progress.
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/ota');
		xhr.upload.onprogress = (e) => (percent = Math.round((e.loaded / e.total) * 100));
		xhr.onload = () => {
			if (xhr.status === 200) {
				percent = 100;
				message = 'Installed – the device restarts…';
				setTimeout(() => location.reload(), 8000);
			} else {
				failed = true;
				message = 'Update failed: ' + (xhr.responseText || xhr.statusText);
			}
		};
		xhr.onerror = () => {
			failed = true;
			message = 'Upload failed – is the device still reachable?';
		};
		xhr.send(file);
	}
</script>

<Panel title="Firmware update">
	<FileDrop
		{file}
		accept=".bin"
		label="Choose a firmware .bin"
		disabled={uploading}
		onpick={pick}
	/>
	{#if percent !== null}<div class="mt-2.5">
			<Progress value={percent / 100} error={failed} />
		</div>{/if}
	{#if message}<p class="mt-2 text-sm" class:text-err={failed} class:text-ok={!failed}>
			{message}
		</p>{/if}

	<div class="mt-3 flex flex-wrap items-center gap-2">
		<Button variant="primary" onclick={upload} disabled={!file || uploading}>
			{uploading ? `Uploading… ${percent} %` : 'Install & restart'}
		</Button>
	</div>
</Panel>
