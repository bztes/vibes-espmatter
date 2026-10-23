<!-- Admin: who can sign up, and the build workers that compile the firmware. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		deleteWorker,
		getSignUpEnabled,
		getWorkers,
		setSignUpEnabled,
		testWorker
	} from '#lib/api/admin.remote.ts';
	import WorkerDialog from '#lib/components/WorkerDialog.svelte';
	import { errorMessage } from '#lib/errors.ts';
	import {
		Alert,
		Button,
		Log,
		Panel,
		showAlert,
		showConfirm,
		StatusDot,
		Switch
	} from '#lib/device/device-ui/ui/index.ts';

	type Worker = Awaited<ReturnType<typeof getWorkers>>[number];

	const workers = $derived(await getWorkers());
	const signUpEnabled = $derived(await getSignUpEnabled());

	async function toggleSignUp(enabled: boolean) {
		try {
			await setSignUpEnabled(enabled);
		} catch (err) {
			await showAlert('Sign-up', errorMessage(err));
		}
	}

	let dialog = $state<ReturnType<typeof WorkerDialog>>();
	/** Test output per worker id; `ok` is undefined while it runs. */
	let tests = $state<Record<string, { ok?: boolean; log: string[] }>>({});

	async function test(id: string) {
		tests[id] = { log: [] };
		try {
			tests[id] = await testWorker(id);
		} catch (err) {
			tests[id] = { ok: false, log: [errorMessage(err)] };
		}
	}

	async function remove(worker: Worker) {
		const ok = await showConfirm(
			'Delete build worker',
			`Delete “${worker.name}” and its workspaces?`,
			{ action: 'Delete', danger: true }
		);
		if (!ok) return;
		try {
			await deleteWorker(worker.id);
		} catch (err) {
			await showAlert('Delete build worker', errorMessage(err));
		}
	}
</script>

<svelte:head>
	<title>Admin – vibes-espmatter</title>
</svelte:head>

<div class="mx-auto max-w-[1024px] px-4 py-6">
	<h1 class="mt-0 mb-1 text-xl">Admin</h1>
	<p class="mt-0 mb-6 text-sm text-muted">Only admins can see this page.</p>

	<h2 class="mt-0 mb-4 text-lg">Accounts</h2>
	<Panel class="mb-8">
		<label class="flex items-center gap-3">
			<span class="flex-1">
				<strong>Allow sign-up</strong>
				<span class="block text-sm text-muted"
					>Anyone who can reach this server can create an account. New accounts are not admins.</span
				>
			</span>
			<Switch
				checked={signUpEnabled}
				onchange={(e) => toggleSignUp(e.currentTarget.checked)}
				aria-label="Allow sign-up"
			/>
		</label>
	</Panel>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<h2 class="m-0 flex-1 text-lg">Build workers</h2>
		<Button onclick={() => getWorkers().refresh()}>Refresh</Button>
		<Button variant="primary" onclick={() => dialog?.open()}>Add worker</Button>
	</div>
	<p class="mt-0 mb-4 text-sm text-muted">
		Each enabled worker compiles one build at a time; queued builds go to the next free one.
	</p>

	{#if !workers.some((w) => w.enabled)}
		<div class="mb-4">
			<Alert tone="info"
				>No build worker is enabled, so builds fail. With Docker Compose, add the <code>idf</code>
				service: an idf-worker.py at <code>http://idf:3001</code> (with docker-compose.dev.yaml:
				<code>http://localhost:3001</code>).</Alert
			>
		</div>
	{/if}

	{#if workers.length}
		<Panel flush class="px-4"
			><ul class="m-0 list-none p-0">
				{#each workers as w (w.id)}
					{@const result = tests[w.id]}
					{@const target = w.kind === 'idf-docker' ? w.config.url : w.config.idfPath}
					<li class="py-3.5 not-first:border-t">
						<div class="flex flex-wrap items-center gap-3">
							<div class="min-w-0 flex-1">
								<strong>{w.name}</strong>
								<span class="text-sm text-muted">
									· {target} · {w.config.maxWorkspaces}
									workspaces</span
								>
								<div class="mt-1 text-sm">
									{#if !w.enabled}
										<StatusDot label="Disabled" />
									{:else if w.buildId}
										<StatusDot tone="warn" label="Building" />
										<a href={resolve('/builds/[id]', { id: w.buildId })}>view build</a>
									{:else}
										<StatusDot tone="ok" label="Idle" />
									{/if}
								</div>
							</div>
							<Button disabled={result && result.ok === undefined} onclick={() => test(w.id)}
								>Test</Button
							>
							<Button onclick={() => dialog?.open(w)}>Edit</Button>
							<Button variant="danger" onclick={() => remove(w)}>Delete</Button>
						</div>
						{#if result}
							<div class="mt-3">
								<p class="mt-0 mb-1 text-sm">
									{#if result.ok === undefined}
										Running <code>idf.py --version</code>…
									{:else if result.ok}
										<StatusDot tone="ok" label="ESP-IDF works" />
									{:else}
										<StatusDot tone="err" label="Test failed" />
									{/if}
								</p>
								<Log lines={result.log} height={120} empty="…" />
							</div>
						{/if}
					</li>
				{/each}
			</ul></Panel
		>
	{/if}
</div>

<WorkerDialog bind:this={dialog} />
