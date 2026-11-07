<!-- The device's REST API, assembled from the platform and every enabled plugin. -->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Download from '@lucide/svelte/icons/download';
	import Lock from '@lucide/svelte/icons/lock';
	import type { ApiRoute } from '#sdk';
	import { resolve as path } from '$app/paths';
	import type { Assembly } from '#lib/core/assemble.ts';
	import {
		Badge,
		button,
		Card,
		Checkbox,
		Code,
		CodeBlock,
		CopyButton,
		Notice
	} from '#lib/ui/index.ts';

	let {
		assembly,
		firmwareId,
		address,
		token
	}: {
		assembly: Assembly;
		firmwareId: string;
		/** On a device's page: its URL (remote access) and token for the examples. */
		address?: string | null;
		token?: string;
	} = $props();

	const base = $derived(address ?? 'http://<device>');
	const groups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const map = new Map<string, ApiRoute[]>();
		for (const r of assembly.api)
			map.set(r.source ?? 'Platform', [...(map.get(r.source ?? 'Platform') ?? []), r]);
		return [...map.entries()];
	});
	const methodTone = { GET: 'info', POST: 'ok', PUT: 'warn', DELETE: 'err' } as const;
	let showToken = $state(false);

	function curl(r: ApiRoute): string {
		const parts = ['curl'];
		if (r.method !== 'GET') parts.push(`-X ${r.method}`);
		if (r.auth === 'token')
			parts.push(`-H "Authorization: Bearer ${showToken && token ? token : '$TOKEN'}"`);
		const body = r.params?.filter(
			(p) => (p.in ?? (r.method === 'GET' ? 'query' : 'body')) === 'body'
		);
		if (r.rawBody) parts.push(`-H "Content-Type: ${r.rawBody.contentType}" --data-binary @app.bin`);
		else if (body?.length) {
			const example = Object.fromEntries(
				body.map((p) => [
					p.name,
					p.type === 'number' ? 0 : p.type === 'boolean' ? true : p.type === 'object' ? {} : '…'
				])
			);
			parts.push(`-H "Content-Type: application/json" -d '${JSON.stringify(example)}'`);
		}
		parts.push(`${base}${r.path.replace('*', '…')}`);
		return parts.join(' \\\n  ');
	}
</script>

{#if !assembly.resolved.has('ip')}
	<Notice tone="warn">This configuration has no IP network, so there is no REST API.</Notice>
{:else}
	<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<p class="m-0 max-w-2xl text-sm text-muted">
			Every device speaks JSON over HTTP – handy for scripts, Home Assistant’s RESTful integration
			or devices without a UI. Authenticate with the device’s API token as Bearer token. <strong
				>{assembly.api.length} routes</strong
			>, from the platform and {groups.length - 1} plugin{groups.length === 2 ? '' : 's'}.
		</p>
		<div class="flex items-center gap-2">
			{#if token}<Checkbox
					class="gap-1.5 text-xs text-muted"
					label="Token in examples"
					bind:checked={showToken}
				/>{/if}
			<a
				class={button({ size: 'sm', class: 'no-underline' })}
				href="{path('/firmware/[id]/openapi.json', { id: firmwareId })}{address
					? `?address=${encodeURIComponent(address)}`
					: ''}"
				data-sveltekit-reload
				download><Download size={15} />OpenAPI</a
			>
		</div>
	</div>

	<div class="grid gap-5">
		{#each groups as [source, routes] (source)}
			<Card title={source} flush>
				<ul class="m-0 list-none divide-y divide-border p-0">
					{#each routes as r, i (i)}
						<li>
							<details class="group">
								<summary
									class="flex cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-surface-2/60"
								>
									<ChevronRight
										size={15}
										class="shrink-0 text-muted transition-transform group-open:rotate-90"
									/>
									<span class="w-16 shrink-0"
										><Badge tone={methodTone[r.method]}>{r.method}</Badge></span
									>
									<Code class="min-w-0 truncate text-[13px]">{r.path}</Code>
									<span class="ml-auto hidden truncate text-sm text-muted md:block"
										>{r.summary}</span
									>
									{#if r.auth === 'token'}<Lock
											size={14}
											class="shrink-0 text-muted"
											aria-label="Needs token"
										/>{/if}
								</summary>
								<div
									class="grid gap-4 border-t border-border bg-surface-2/40 px-5 py-4 md:grid-cols-2"
								>
									<div class="grid content-start gap-3 text-sm">
										<p class="m-0 font-medium">{r.summary}</p>
										{#if r.description}<p class="m-0 text-muted">{r.description}</p>{/if}
										<p class="m-0 text-xs text-muted">
											{r.auth === 'token'
												? 'Needs `Authorization: Bearer <token>` (API token or web UI session).'
												: 'No authentication.'}
										</p>
										{#if r.params?.length}
											<table class="w-full text-xs">
												<tbody>
													{#each r.params as p (p.name)}
														<tr class="border-t border-border">
															<td class="py-1 pr-2 align-top"
																><Code class="font-semibold">{p.name}</Code>{#if p.required}<span
																		class="text-err">*</span
																	>{/if}</td
															>
															<td class="py-1 pr-2 align-top text-muted"
																>{p.type}{p.in === 'query' ? ' · query' : ''}</td
															>
															<td class="py-1 align-top">{p.description}</td>
														</tr>
													{/each}
												</tbody>
											</table>
										{/if}
										{#if r.rawBody}<p class="m-0 text-xs">
												<Code>{r.rawBody.contentType}</Code> – {r.rawBody.description}
											</p>{/if}
									</div>
									<div class="grid min-w-0 content-start gap-3">
										<div class="relative">
											<CodeBlock tone="terminal" class="pr-10">{curl(r)}</CodeBlock>
											<div class="absolute top-1.5 right-1.5 text-white">
												<CopyButton text={curl(r)} label="Copy curl command" />
											</div>
										</div>
										{#if r.response}
											<CodeBlock tone="outline" class="max-h-60"
												>{JSON.stringify(r.response, null, 2)}</CodeBlock
											>
										{/if}
									</div>
								</div>
							</details>
						</li>
					{/each}
				</ul>
			</Card>
		{/each}
	</div>
{/if}
