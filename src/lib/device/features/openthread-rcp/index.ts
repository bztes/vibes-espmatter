import { configuratorEditors, firmware } from '../core/services';
import type { FeatureDef, FeatureIssue, Validate } from '../../types';
import { RCP_BAUD } from '../thread-br/index.ts';
import Editor from './configurator/Editor.svelte';
import rcpC from './firmware/esp_ot_rcp.c?raw';

const defaults = () => ({ txGpio: 24, rxGpio: 23 });
export type OpenthreadRcpConfig = ReturnType<typeof defaults>;

const validate: Validate<OpenthreadRcpConfig> = ({ config, chipsWith }) => {
	const errors: FeatureIssue<OpenthreadRcpConfig>[] = [];
	if (config.rxGpio === config.txGpio)
		errors.push({ field: 'txGpio', message: 'UART RX and TX must be different pins.' });
	if (chipsWith('thread_br').length === 0) {
		errors.push('Needs another board with the “Thread border router” feature that controls it.');
	}
	return errors;
};

/** Turns an 802.15.4 capable chip (ESP32-H2 / C6) into a Spinel radio co-processor. */
export default {
	id: 'openthread_rcp',
	dir: 'openthread-rcp',
	name: 'Thread radio (RCP)',
	description: 'Thread radio for a border router, over UART.',
	category: 'thread',
	framework: 'esp-idf',
	chips: ['esp32h2', 'esp32c6'],
	flashFirst: true,
	// The border router on the host is at the other end of its UART.
	link: 'thread_br',
	defaults,
	pins: [
		{ key: 'txGpio', label: 'UART TX (to host RX)' },
		{ key: 'rxGpio', label: 'UART RX (from host TX)' }
	],
	validate,
	activate({ use, config }) {
		use(configuratorEditors).register(Editor);
		use(firmware).register(() => ({
			// Based on esp-idf examples/openthread/ot_rcp/sdkconfig.defaults
			sdkconfig: {
				CONFIG_OPENTHREAD_ENABLED: true,
				CONFIG_OPENTHREAD_RADIO: true,
				CONFIG_OPENTHREAD_RCP_UART: true,
				CONFIG_OPENTHREAD_DIAG: false,
				CONFIG_OPENTHREAD_COMMISSIONER: false,
				CONFIG_OPENTHREAD_JOINER: false,
				CONFIG_OPENTHREAD_BORDER_ROUTER: false,
				CONFIG_OPENTHREAD_CLI: false,
				CONFIG_OPENTHREAD_SRP_CLIENT: false,
				CONFIG_OPENTHREAD_DNS_CLIENT: false,
				CONFIG_OPENTHREAD_TASK_SIZE: 3072,
				CONFIG_OPENTHREAD_CONSOLE_ENABLE: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_DYNAMIC: false,
				CONFIG_OPENTHREAD_LOG_LEVEL_NONE: true,
				CONFIG_OPENTHREAD_TIMING_OPTIMIZATION: true,
				CONFIG_ESP_COEX_SW_COEXIST_ENABLE: false,
				CONFIG_BOOTLOADER_LOG_LEVEL_ERROR: true,
				CONFIG_COMPILER_OPTIMIZATION_SIZE: true,
				CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_SILENT: true,
				CONFIG_COMPILER_OPTIMIZATION_CHECKS_SILENT: true,
				CONFIG_COMPILER_SAVE_RESTORE_LIBCALLS: true,
				CONFIG_ESP_ERR_TO_NAME_LOOKUP: false,
				CONFIG_ESP_SYSTEM_PANIC_SILENT_REBOOT: true,
				CONFIG_LOG_DEFAULT_LEVEL_NONE: true,
				CONFIG_LIBC_NEWLIB_NANO_FORMAT: true,
				CONFIG_FREERTOS_HZ: 1000
			},
			defines: {
				MESP_RCP_TX_PIN: Number(config.txGpio),
				MESP_RCP_RX_PIN: Number(config.rxGpio),
				MESP_RCP_BAUD: RCP_BAUD
			},
			sources: { 'esp_ot_rcp.c': rcpC },
			hooks: {
				globals: ['void mesp_rcp_start(void);'],
				postStart: ['mesp_rcp_start();']
			}
		}));
	}
} satisfies FeatureDef<OpenthreadRcpConfig>;
