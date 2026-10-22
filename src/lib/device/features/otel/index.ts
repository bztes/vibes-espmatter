import { configuratorEditors, firmware } from '../core/services';
import type { Contribution, FeatureDef, FeatureIssue, Validate } from '../../types';
import { deviceApi } from '../http-server/services';
import { devicePanels } from '../web-ui/services';
import { api } from './api';
import Editor, { LOG_LEVELS } from './configurator/Editor.svelte';
import otelCpp from './firmware/espm_otel.cpp?raw';
import otelH from './firmware/espm_otel.h?raw';
import { clock } from '../ntp/services';
import { network } from '../wifi/services';

const defaults = () => ({
	endpoint: '',
	serviceName: '',
	authorization: '',
	metrics: true,
	interval: 60,
	system: true,
	logs: false,
	logLevel: 'warn',
	logInterval: 0
});
export type OtelConfig = ReturnType<typeof defaults>;

const validate: Validate<OtelConfig> = ({ config }) => {
	const errors: FeatureIssue<OtelConfig>[] = [];
	if (config.endpoint.length > 200)
		errors.push({ field: 'endpoint', message: 'OTLP endpoint must be at most 200 characters.' });
	else if (config.endpoint && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(config.endpoint))
		errors.push({
			field: 'endpoint',
			message: 'OTLP endpoint must be an http:// or https:// URL.'
		});
	if (config.serviceName.length > 64)
		errors.push({ field: 'serviceName', message: 'Service name must be at most 64 characters.' });
	if (config.authorization.length > 256)
		errors.push({
			field: 'authorization',
			message: 'Authorization header must be at most 256 characters.'
		});
	if (config.metrics && !(config.interval >= 10 && config.interval <= 3600))
		errors.push({ field: 'interval', message: 'Every (seconds) must be between 10 and 3600.' });
	if (config.logs && !LOG_LEVELS.some((l) => l.value === config.logLevel))
		errors.push({ field: 'logLevel', message: 'Level: invalid option.' });
	if (config.logs && !(config.logInterval >= 0 && config.logInterval <= 3600))
		errors.push({ field: 'logInterval', message: 'Every (seconds) must be between 0 and 3600.' });
	if (!config.metrics && !config.logs)
		errors.push('OpenTelemetry: switch on metrics, logs or both.');
	return errors;
};

/**
 * OpenTelemetry: the device sends measurements of its features (e.g. the heat pump's
 * temperatures, or the Matter controller's paired devices: temperature, humidity, battery, on/off)
 * and optionally its own (uptime, memory, Wi-Fi signal) as OTLP/HTTP JSON to a
 * backend that stores and charts them – OpenObserve, VictoriaMetrics, an OpenTelemetry Collector
 * … Features record values with `mesp_otel_gauge()` / `mesp_otel_counter()` (`espm_otel.h`)
 * when `MESP_OTEL` is set. Optionally the device's log lines go to the same backend as OTLP logs.
 * The endpoint is the OTLP base URL; the firmware adds `/v1/metrics` and `/v1/logs`.
 */
export default {
	// Saved projects use this id – keep it.
	id: 'otel_metrics',
	dir: 'otel',
	name: 'OpenTelemetry',
	description: 'Sends metrics and logs to OpenObserve, VictoriaMetrics or another OTLP backend.',
	category: 'network',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	defaults,
	validate,
	activate({ use, find, config, has }) {
		use(network);
		// Timestamps need the clock.
		use(clock);
		use(configuratorEditors).register(Editor);
		// Its routes are for the admin dashboard's panel.
		if (has('admin_dashboard')) find(deviceApi)?.register(...api);
		find(devicePanels)?.register({
			id: 'otel',
			title: 'OpenTelemetry',
			file: 'OtelPanel.svelte',
			area: 'main',
			section: 'system'
		});
		use(firmware).register(() => {
			// HTTPS endpoints need the CA bundle. With the admin dashboard the endpoint can be
			// changed on the device later, so include it then too – it can't be added after flashing.
			const sdkconfig: Contribution['sdkconfig'] = {};
			if (has('admin_dashboard') || config.endpoint.startsWith('https:'))
				sdkconfig.CONFIG_MBEDTLS_CERTIFICATE_BUNDLE = true;
			const notes: string[] = [];
			if (config.endpoint.startsWith('http:') && config.authorization)
				notes.push(
					'OpenTelemetry: the endpoint is plain HTTP, so the Authorization header goes over the network unencrypted. Use https:// outside your home network.'
				);
			const defines: Contribution['defines'] = {
				MESP_OTEL: true,
				MESP_OTEL_ENDPOINT: config.endpoint,
				MESP_OTEL_AUTH: config.authorization,
				MESP_OTEL_SERVICE: config.serviceName.trim(),
				MESP_OTEL_METRICS: config.metrics,
				MESP_OTEL_INTERVAL_S: config.interval,
				MESP_OTEL_SYSTEM: config.system,
				MESP_OTEL_LOGS: config.logs,
				MESP_OTEL_LOG_LEVEL: { error: 'E', warn: 'W', info: 'I' }[config.logLevel] ?? 'W',
				MESP_OTEL_LOG_INTERVAL_S: config.logInterval
			};
			if (!config.endpoint)
				notes.push('OpenTelemetry: no endpoint yet – set it in the admin dashboard (System page).');
			return {
				sdkconfig,
				defines,
				sources: { 'espm_otel.cpp': otelCpp, 'espm_otel.h': otelH },
				hooks: {
					includes: ['#include "espm_otel.h"'],
					preStart: ['mesp_otel_init();'],
					postStart: [
						'mesp_otel_start();',
						...(has('admin_dashboard') ? ['mesp_otel_register_web();'] : [])
					]
				},
				notes
			};
		});
	}
} satisfies FeatureDef<OtelConfig>;
