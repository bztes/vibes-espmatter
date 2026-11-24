import { Stored } from '#sdk/device-ui';
import { isPreset, presetView, type View } from './ranges';

/** Presets are remembered for all charts; a stepped, zoomed or custom range only for this visit. */
const preset = new Stored('espm.history.range', 'today', isPreset);

/** The time range of charts, starting at `start` or the remembered preset. */
export class Range {
	view = $state<View>() as View;

	constructor(start?: View) {
		this.view = start ?? presetView(preset.value);
	}

	set = (v: View) => {
		if (v.preset) preset.value = v.preset;
		this.view = v;
	};

	zoom = (from: number, to: number) => this.set({ from, to });
}
