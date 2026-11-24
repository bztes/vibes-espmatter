// A value on a card with a history opens its chart in a popup.
import type { ValueTarget } from '#sdk/device-ui';
import ValueHistory from './ValueHistory.svelte';
import { catalog, loadCatalog } from './catalog.svelte';
import { seriesKey } from './sources';

const target: ValueTarget = (ref) => {
	// Loaded once on first use; the history page keeps it fresh.
	if (catalog.current === undefined && !catalog.error) void loadCatalog();
	const device = catalog.current?.devices.find((d) =>
		ref.own ? d.own : Number(d.node) === ref.node
	);
	const value = seriesKey({ metric: ref.metric, labels: ref.labels ?? '' });
	if (!device?.series.some((s) => seriesKey(s) === value)) return;
	return {
		title: `History of ${ref.label}`,
		popup: {
			title: `${device.name} · ${ref.label}`,
			component: ValueHistory,
			props: { device: device.id, value, pageLink: true }
		}
	};
};

export default target;
