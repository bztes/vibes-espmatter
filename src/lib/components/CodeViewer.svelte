<script lang="ts">
	import type { GeneratedProject } from '#lib/device/types.ts';
	import { slugify } from '#lib/device/util.ts';
	import { createZip } from '#lib/zip.ts';
	import { Button, Log, Segmented } from '#lib/device/device-ui/ui/index.ts';

	let { projects, name }: { projects: GeneratedProject[]; name: string } = $props();

	let roleId = $state<string>();
	let file = $state('main/app_main.cpp');
	let copied = $state(false);

	const current = $derived(projects.find((p) => p.role.id === roleId) ?? projects.at(-1));
	const files = $derived(current ? Object.keys(current.files).sort(sortFiles) : []);
	const selected = $derived(
		files.includes(file) ? file : (files.find((f) => f.startsWith('main/app_main')) ?? files[0])
	);

	function sortFiles(a: string, b: string) {
		const depth = (f: string) => f.split('/').length;
		return depth(a) - depth(b) || a.localeCompare(b);
	}

	function download() {
		const all: Record<string, string> = {};
		const root = slugify(name);
		for (const p of projects) {
			for (const [path, content] of Object.entries(p.files))
				all[`${root}/${p.role.id}/${path}`] = content;
		}
		const url = URL.createObjectURL(createZip(all));
		const a = document.createElement('a');
		a.href = url;
		a.download = `${root}-source.zip`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function copy() {
		if (!current || !selected) return;
		await navigator.clipboard.writeText(current.files[selected]);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
	<div class="flex flex-wrap items-center gap-2">
		{#if projects.length > 1}
			<Segmented
				label="Board"
				options={projects.map((p) => [p.role.id, `${p.role.name} (${p.target})`] as const)}
				bind:value={() => current?.role.id ?? '', (id) => (roleId = id)}
			/>
		{/if}
		<Button class="ml-auto" onclick={download}>Download .zip</Button>
	</div>

	{#if current}
		<div class="grid grid-cols-[220px_minmax(0,1fr)] gap-3 max-[900px]:grid-cols-[minmax(0,1fr)]">
			<ul class="m-0 max-h-[560px] list-none overflow-auto p-0">
				{#each files as f (f)}
					<li>
						<button
							class={[
								'block w-full cursor-pointer truncate border-0 px-2 py-[3px] text-left font-mono text-xs',
								f === selected ? 'bg-bg text-accent' : 'bg-transparent hover:bg-bg'
							]}
							onclick={() => (file = f)}
							title={f}>{f}</button
						>
					</li>
				{/each}
			</ul>
			<div class="relative min-w-0">
				<Button size="sm" class="absolute top-2 right-2" onclick={copy}
					>{copied ? 'Copied' : 'Copy'}</Button
				>
				<Log text={selected ? current.files[selected] : ''} follow={false} height={560} />
			</div>
		</div>
	{/if}
</div>
