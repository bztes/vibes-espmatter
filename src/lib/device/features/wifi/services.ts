import { defineFirmwareApi } from '../../services';

/** The network connection: for features whose firmware talks to the network. */
export const network = defineFirmwareApi('wifi.network', 'wifi');
