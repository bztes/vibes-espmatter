import { defineFirmwareApi } from '../../services';

/** The Matter node (`espm_node.h`): for features whose firmware adds endpoints to it. */
export const matterNode = defineFirmwareApi('matter_device.node', 'matter_device');
