<!-- Add or edit a build worker (admin): idf-worker.py at a URL, or a local ESP-IDF checkout. -->
<script lang="ts">
	import { saveWorker, type WorkerInput } from '#lib/api/admin.remote.ts';
	import { errorMessage } from '#lib/errors.ts';
	import type { Worker, WorkerKind } from '#lib/server/db/schema.ts';
	import {
		Alert,
		Button,
		Dialog,
		Input,
		Segmented,
		Switch
	} from '#lib/device/device-ui/ui/index.ts';

	interface Draft {
		id?: string;
		name: string;
		enabled: boolean;
		kind: WorkerKind;
		url: string;
		idfPath: string;
		idfPython: string;
		maxWorkspaces: number;
	}

	let dialog = $state<ReturnType<typeof Dialog>>();
	let draft = $state<Draft>(blank());
	let saving = $state(false);
	let problem = $state('');

	function blank(): Draft {
		return {
			name: '',
			enabled: true,
			kind: 'idf-docker',
			url: '',
			idfPath: '',
			idfPython: '',
			maxWorkspaces: 4
		};
	}

	/** Without `worker`: add a new one. */
	export function open(worker?: Worker) {
		draft = worker
			? {
					...blank(),
					id: worker.id,
					name: worker.name,
					enabled: worker.enabled,
					kind: worker.kind,
					...worker.config
				}
			: blank();
		problem = '';
		dialog?.open();
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const { id, name, enabled, url, idfPath, idfPython, maxWorkspaces } = draft;
		const common = { id, name, enabled };
		const input: WorkerInput =
			draft.kind === 'idf-docker'
				? { ...common, kind: 'idf-docker', config: { url, maxWorkspaces } }
				: { ...common, kind: 'idf-local', config: { idfPath, idfPython, maxWorkspaces } };
		saving = true;
		problem = '';
		try {
			await saveWorker(input);
			dialog?.close();
		} catch (err) {
			problem = errorMessage(err);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:this={dialog} width={480}>
	<h2 class="mt-0 mb-3 text-[16px]">{draft.id ? 'Edit build worker' : 'Add a build worker'}</h2>
	<form onsubmit={save}>
		<Input label="Name" required maxlength={48} placeholder="idf" bind:value={draft.name} />
		<div class="mb-2.5">
			<Segmented
				label="Type"
				stretch
				options={[
					['idf-docker', 'ESP-IDF Docker'],
					['idf-local', 'ESP-IDF local']
				]}
				bind:value={draft.kind}
			/>
		</div>
		{#if draft.kind === 'idf-docker'}
			<Input
				label="Worker URL"
				type="url"
				required
				placeholder="http://idf:3001"
				bind:value={draft.url}
			/>
			<p class="mt-0 mb-2.5 text-xs text-muted">
				idf-worker.py in the <code>espressif/idf</code> image, e.g. the <code>idf</code> service of docker-compose.yaml.
				It must see the data directory at the same path as this server.
			</p>
		{:else}
			<Input
				label="ESP-IDF path (on this server)"
				required
				placeholder="/home/me/esp/esp-idf"
				bind:value={draft.idfPath}
			/>
			<Input
				label="Python (optional)"
				placeholder="The python ESP-IDF was installed with, if not the default one"
				bind:value={draft.idfPython}
			/>
		{/if}
		<Input
			label="Workspaces kept (≈1–2 GB each, for fast incremental rebuilds)"
			type="number"
			min={1}
			max={100}
			required
			bind:value={draft.maxWorkspaces}
		/>
		<label class="mb-2.5 flex items-center gap-2 text-sm">
			<Switch bind:checked={draft.enabled} aria-label="Enabled" />
			Enabled: takes new builds
		</label>
		{#if problem}<Alert>{problem}</Alert>{/if}
		<div class="mt-3 flex justify-end gap-2">
			<Button type="button" onclick={() => dialog?.close()}>Cancel</Button>
			<Button type="submit" variant="primary" disabled={saving}>Save</Button>
		</div>
	</form>
</Dialog>
