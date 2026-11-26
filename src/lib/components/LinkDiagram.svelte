<!-- How a hub or device talks to the app: App – Hub – Device, with the update and access paths. -->
<script lang="ts">
	import type { DeviceKind } from '#sdk';
	import type { EffectiveLink } from '#lib/core/link.ts';

	let {
		kind,
		link,
		thread = false,
		name,
		hub,
		app
	}: {
		kind: DeviceKind;
		link: EffectiveLink;
		/** A device on Thread (no network of its own to the app). */
		thread?: boolean;
		name?: string;
		/** Name of the device's hub; null: none picked. */
		hub?: string | null;
		/** Where the app is, e.g. its host. */
		app?: string;
	} = $props();

	const UPDATES = 'var(--color-accent)';
	const ACCESS = 'var(--color-info)';
	const X = { app: 80, hub: 300, dev: 520 };
	const W = 124;
	const H = 54;
	const Y = 95;
	const L = (x: number) => x - W / 2;
	const R = (x: number) => x + W / 2;

	type Edge = {
		d: string;
		color: string;
		label: string;
		lx: number;
		ly: number;
		curve?: 'up' | 'down';
	};

	const straight = (from: number, to: number, dy: number, color: string, label: string): Edge => ({
		d: `M${R(from)} ${Y + dy} L${L(to)} ${Y + dy}`,
		color,
		label,
		lx: (R(from) + L(to)) / 2,
		ly: Y + dy + (dy < 0 ? -6 : 14)
	});
	/** From the app to the device, around the hub (above or below). */
	const around = (up: boolean, color: string, label: string): Edge => {
		const y0 = Y + (up ? -12 : 12);
		const y1 = up ? 14 : 176;
		return {
			d: `M${R(X.app)} ${y0} C ${R(X.app) + 60} ${y1}, ${L(X.dev) - 60} ${y1}, ${L(X.dev)} ${y0}`,
			color,
			label,
			lx: X.hub,
			ly: up ? 22 : 174,
			curve: up ? 'up' : 'down'
		};
	};

	const edges = $derived.by(() => {
		const out: Edge[] = [];
		if (kind === 'hub') {
			out.push(straight(X.app, X.hub, -10, UPDATES, 'updates'));
			if (link.access === 'tunnel') out.push(straight(X.app, X.hub, 10, ACCESS, 'tunnel'));
			// Paired devices get their updates over Matter.
			out.push(straight(X.hub, X.dev, -10, UPDATES, 'updates'));
			if (link.relay && link.access === 'tunnel')
				out.push(straight(X.hub, X.dev, 10, ACCESS, 'access'));
			return out;
		}
		out.push(
			straight(X.app, X.hub, -10, UPDATES, 'updates'),
			straight(X.hub, X.dev, -10, UPDATES, 'updates')
		);
		if (link.access === 'tunnel') out.push(around(false, ACCESS, 'tunnel'));
		else if (link.access === 'hub')
			out.push(
				straight(X.app, X.hub, 10, ACCESS, 'tunnel'),
				straight(X.hub, X.dev, 10, ACCESS, 'access')
			);
		return out;
	});

	type Node = { x: number; title: string; sub: string; self?: boolean; faded?: boolean };
	const nodes = $derived<Node[]>(
		kind === 'hub'
			? [
					{ x: X.app, title: 'App', sub: app ?? '' },
					{
						x: X.hub,
						title: name ?? 'This hub',
						sub: link.relay ? 'relay on' : 'no relay',
						self: true
					},
					{
						x: X.dev,
						title: 'Other devices',
						sub: link.relay ? 'through this hub' : 'not through this hub',
						faded: !link.relay
					}
				]
			: [
					{ x: X.app, title: 'App', sub: app ?? '' },
					{
						x: X.hub,
						title: hub ?? 'Hub',
						sub: link.viaHub ? (hub === null ? 'none picked' : 'relay') : 'not used',
						faded: !link.viaHub
					},
					{
						x: X.dev,
						title: name ?? 'This device',
						sub: thread ? 'Thread' : 'Wi-Fi / Ethernet',
						self: true
					}
				]
	);

	/** Only as tall as the paths need. */
	const top = $derived(edges.some((e) => e.curve === 'up') ? 8 : 56);
	const bottom = $derived(edges.some((e) => e.curve === 'down') ? 184 : 134);

	const ids = $props.id();
	const marker = (color: string) => `${ids}-${color === UPDATES ? 'u' : 'a'}`;
</script>

<div class="overflow-x-auto">
	<svg
		viewBox="0 {top} 600 {bottom - top}"
		class="block w-full min-w-[30rem]"
		role="img"
		aria-label="How the {kind === 'hub' ? 'hub' : 'device'} talks to the app"
	>
		<defs>
			{#each [UPDATES, ACCESS] as color (color)}
				<marker
					id={marker(color)}
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0 0 L10 5 L0 10 z" fill={color} />
				</marker>
			{/each}
		</defs>

		{#each edges as e, i (i)}
			<path
				d={e.d}
				fill="none"
				stroke={e.color}
				stroke-width="2"
				marker-end="url(#{marker(e.color)})"
			/>
			<text
				x={e.lx}
				y={e.ly}
				text-anchor="middle"
				font-size="11"
				font-weight="600"
				fill={e.color}
				stroke="var(--color-surface)"
				stroke-width="4"
				paint-order="stroke">{e.label}</text
			>
		{/each}

		{#each nodes as n (n.x)}
			<g opacity={n.faded ? 0.4 : 1}>
				<rect
					x={L(n.x)}
					y={Y - H / 2}
					width={W}
					height={H}
					rx="10"
					fill={n.self ? 'var(--color-accent-soft)' : 'var(--color-surface)'}
					stroke={n.self ? 'var(--color-accent)' : 'var(--color-border-strong)'}
					stroke-width={n.self ? 2 : 1}
					stroke-dasharray={n.faded ? '4 3' : undefined}
				/>
				<text
					x={n.x}
					y={Y - 3}
					text-anchor="middle"
					font-size="13"
					font-weight="600"
					fill="var(--color-fg)">{n.title.length > 17 ? n.title.slice(0, 16) + '…' : n.title}</text
				>
				<text x={n.x} y={Y + 14} text-anchor="middle" font-size="10.5" fill="var(--color-muted)"
					>{n.sub.length > 22 ? n.sub.slice(0, 21) + '…' : n.sub}</text
				>
			</g>
		{/each}
	</svg>
</div>
<div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
	<span class="flex items-center gap-1.5"
		><span class="h-0.5 w-5 rounded" style:background={UPDATES}></span>Updates and reports (pulled)</span
	>
	<span class="flex items-center gap-1.5"
		><span class="h-0.5 w-5 rounded" style:background={ACCESS}></span>The app reaches it (web
		interface, REST API)</span
	>
</div>
