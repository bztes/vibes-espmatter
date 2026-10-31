import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import otelMetricsCpp from './firmware/espm_otel_metrics.cpp?raw';
import { matterController } from '../matter-controller/services';
import { otel } from '../otel/services';

/**
 * OpenTelemetry metrics: the values of the devices paired with the Matter controller (battery,
 * power, energy, temperature, humidity, on/off, brightness, color temperature) as OpenTelemetry
 * metrics. They come from the controller's values listener (`mesp_matter_on_values()`); a device's
 * metrics stop while it's offline.
 */
export default {
	id: 'otel_metrics',
	dir: 'otel-metrics',
	name: 'OpenTelemetry metrics',
	description: 'Sends the values of the paired Matter devices over OpenTelemetry.',
	category: 'matter',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	activate({ use }) {
		use(matterController);
		use(otel);
		use(firmware).register(() => ({
			sources: { 'espm_otel_metrics.cpp': otelMetricsCpp },
			hooks: {
				globals: ['void mesp_otel_metrics_init();'],
				preStart: ['mesp_otel_metrics_init();']
			}
		}));
	}
} satisfies FeatureDef;
