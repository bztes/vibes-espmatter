<!--
	The REST API docs of a chip, the configurator's API tab: the routes its features registered
	(`deviceApi`) as currently configured, with curl examples for the device's address and an OpenAPI
	download.
-->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import type { ConfiguratorTabProps } from '#lib/device/configurator.ts';
	import { Badge, Button, Panel } from '#lib/device/device-ui/ui/index.ts';
	import type { DeviceApiRoute } from '#lib/device/types.ts';
	import { openApi } from './openapi.ts';
	import { documentedRoutes } from '../services.ts';

	let { project, chip, config, services, address }: ConfiguratorTabProps = $props();

	const routes = $derived(documentedRoutes(services));
	const groups = $derived(
		[...new Set(routes.map((r) => r.feature))].map((feature) => ({
			feature,
			routes: routes.filter((r) => r.feature === feature)
		}))
	);
	const port = $derived(Number(config.port));
	const base = $derived(
		address?.replace(/\/+$/, '') ?? `http://<device address>${port === 80 ? '' : `:${port}`}`
	);
	const admin = $derived(String(config.username));

	const td = 'border-b py-[5px] pr-2 pl-0 align-top';

	const ACCESS = {
		public: { label: 'no login', tone: 'ok' },
		user: { label: 'logged in', tone: 'warn' },
		admin: { label: 'admins', tone: 'default' }
	} as const;

	function curl(r: DeviceApiRoute): string {
		const auth = r.access === 'public' ? '' : ` -u ${admin}`;
		if (r.rawBody) return `curl${auth} --data-binary @firmware.bin ${base}${r.path}`;
		const fields = (r.params ?? [])
			.filter((p) => p.required)
			.map((p) => ` -d ${p.name}=…`)
			.join('');
		const post = r.method === 'POST' && !fields ? ' -X POST' : '';
		return `curl${auth}${post}${fields} ${base}${r.path}`;
	}

	function download() {
		const doc = openApi(routes, `${project.name} – ${chip.name}`, base);
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${project.name}-${chip.name}-openapi.json`.replace(/[^\w.-]+/g, '-');
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<!-- Text with `code` spans. -->
{#snippet rich(text: string)}
	{#each text.split('`') as part, i (i)}
		{#if i % 2}<code>{part}</code>{:else}{part}{/if}
	{/each}
{/snippet}

<Panel title="REST API – {chip.name}">
	{#snippet badge()}
		<Button onclick={download}><Download size={14} /> OpenAPI</Button>
	{/snippet}
	{#each groups as group (group.feature)}
		<h3 class="mt-5 mb-2 text-sm first-of-type:mt-0">{group.feature}</h3>
		{#each group.routes as r (r.method + r.path)}
			{@const access = ACCESS[r.access]}
			<details class="mb-1.5 rounded-lg border">
				<summary
					class="flex cursor-pointer list-none flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 [&::-webkit-details-marker]:hidden"
				>
					<span
						class={[
							'min-w-[42px] rounded-[5px] px-1.5 py-[3px] text-center font-mono text-2xs/none font-bold text-white',
							r.method === 'GET' ? 'bg-ok' : 'bg-accent'
						]}>{r.method}</span
					>
					<code class="font-semibold">{r.path}</code>
					<span class="flex-[1_1_200px] text-sm text-muted">{@render rich(r.summary)}</span>
					<Badge tone={access.tone}>{access.label}</Badge>
				</summary>
				<div class="border-t px-3 pb-3 text-sm">
					{#if r.description}<p class="mt-2.5 mb-0">{@render rich(r.description)}</p>{/if}
					{#if r.params?.length}
						<h4 class="mt-3.5 mb-1.5 text-2xs tracking-[0.04em] text-muted uppercase">
							Form fields
						</h4>
						<table class="w-full border-collapse text-sm">
							<tbody>
								{#each r.params as p (p.name)}
									<tr>
										<td class="{td} whitespace-nowrap">
											<code>{p.name}</code>
											{#if p.required}<span class="ml-1 text-2xs text-err">required</span>{/if}
										</td>
										<td class="{td} text-muted">{p.type}</td>
										<td class={td}>{@render rich(p.description)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
					{#if r.rawBody}
						<h4 class="mt-3.5 mb-1.5 text-2xs tracking-[0.04em] text-muted uppercase">Body</h4>
						<p class="mt-2.5 mb-0">
							<code>{r.rawBody.type}</code>: {@render rich(r.rawBody.description)}
						</p>
					{/if}
					{#if r.response !== undefined}
						<h4 class="mt-3.5 mb-1.5 text-2xs tracking-[0.04em] text-muted uppercase">Response</h4>
						<pre
							class="m-0 overflow-x-auto rounded-lg bg-bg px-3 py-2.5 font-mono text-xs/[1.45]">{JSON.stringify(
								r.response,
								null,
								2
							)}</pre>
					{/if}
					<h4 class="mt-3.5 mb-1.5 text-2xs tracking-[0.04em] text-muted uppercase">Example</h4>
					<pre
						class="m-0 overflow-x-auto rounded-lg bg-bg px-3 py-2.5 font-mono text-xs/[1.45]">{curl(
							r
						)}</pre>
				</div>
			</details>
		{/each}
	{/each}
</Panel>
