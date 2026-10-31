import { firmware } from '../core/services';
import type { FeatureDef } from '../../types';
import matterControllerThreadCpp from './firmware/espm_matter_controller_thread.cpp?raw';
import { matterController } from '../matter-controller/services';
import { threadNetwork } from '../thread-br/services';

/**
 * Matter controller Thread: the Matter controller pairs devices into the Thread border router's
 * network (over BLE, with its dataset). Without it the controller pairs Wi-Fi and on-network
 * devices only.
 */
export default {
	id: 'matter_controller_thread',
	dir: 'matter-controller-thread',
	name: 'Matter controller Thread',
	description: 'Pairs Thread devices into the border router’s network.',
	category: 'thread',
	chips: ['esp32', 'esp32s3', 'esp32c3'],
	activate({ use }) {
		use(matterController);
		use(threadNetwork);
		use(firmware).register(() => ({
			sources: { 'espm_matter_controller_thread.cpp': matterControllerThreadCpp },
			hooks: {
				globals: ['void mesp_matter_controller_thread_init();'],
				preStart: ['mesp_matter_controller_thread_init();']
			}
		}));
	}
} satisfies FeatureDef;
