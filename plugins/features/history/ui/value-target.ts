// A value on a card with a history opens its chart.
import type { ValueTarget } from '#sdk/device-ui';
import { catalog, loadCatalog } from './catalog.svelte';
import { seriesKey } from './sources';

const target: ValueTarget = (ref) => {
	// Loaded once on first use; the history page keeps it fresh.
	if (catalog.current === undefined && !catalog.error) void loadCatalog();
	const device = catalog.current?.devices.find((d) =>
		ref.own ? d.own : Number(d.node) === ref.node
	);
	const labels = ref.labels ?? '';
	const key = seriesKey({ metric: ref.metric, labels });
	if (!device?.series.some((s) => seriesKey(s) === key)) return;
	const query = new URLSearchParams({ device: device.id, metric: ref.metric, labels });
	return { href: `#/history?${query}`, title: `History of ${ref.label}` };
};

export default target;
