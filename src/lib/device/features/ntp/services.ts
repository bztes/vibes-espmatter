import { defineFirmwareApi } from '../../services';

/** The synchronized clock: for features whose firmware needs the time of day. */
export const clock = defineFirmwareApi('ntp.clock', 'ntp');
