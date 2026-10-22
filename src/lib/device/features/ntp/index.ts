import { configuratorEditors, firmware } from '../core/services';
import type { FeatureDef, FeatureIssue, Validate } from '../../types';
import Editor from './configurator/Editor.svelte';
import ntpCpp from './firmware/espm_ntp.cpp?raw';
import ntpH from './firmware/espm_ntp.h?raw';
import { network } from '../wifi/services';

const defaults = () => ({ server: 'pool.ntp.org' });
export type NtpConfig = ReturnType<typeof defaults>;

const validate: Validate<NtpConfig> = ({ config }) => {
	const server = String(config.server);
	const errors: FeatureIssue<NtpConfig>[] = [];
	if (!server.trim()) errors.push({ field: 'server', message: 'Time server is required.' });
	else if (server.length > 64)
		errors.push({ field: 'server', message: 'Time server must be at most 64 characters.' });
	else if (!/^[A-Za-z0-9.-]+$/.test(server))
		errors.push({ field: 'server', message: 'Time server: letters, digits, dots and dashes.' });
	return errors;
};

/**
 * The wall clock: SNTP sets it from a time server once the device is online, and keeps it in sync.
 * Features that need the time (timers, OpenTelemetry timestamps) require this one
 * and check `mesp_time_synced()` (`espm_ntp.h`). The time zone is the timers' business.
 */
export default {
	id: 'ntp',
	dir: 'ntp',
	name: 'Time server (NTP)',
	description: 'Sets the device clock from an NTP time server.',
	category: 'network',
	chips: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
	defaults,
	validate,
	activate({ use, config }) {
		use(network);
		use(configuratorEditors).register(Editor);
		use(firmware).register(() => ({
			defines: {
				MESP_NTP: true,
				MESP_NTP_SERVER: String(config.server)
			},
			sources: { 'espm_ntp.cpp': ntpCpp, 'espm_ntp.h': ntpH },
			hooks: {
				includes: ['#include "espm_ntp.h"'],
				postStart: ['mesp_ntp_start();']
			}
		}));
	}
} satisfies FeatureDef<NtpConfig>;
