import { defineFirmwareApi } from '../../services';

/** The Matter controller (`espm_matter.h`): for features whose firmware controls the paired devices. */
export const matterController = defineFirmwareApi(
	'matter_controller.controller',
	'matter_controller'
);
