import { defineFirmwareApi } from '../../services';

/** Requests to the vibes-espmatter app with the device's token (`espm_updates.h`). */
export const appUpdates = defineFirmwareApi('app_updates.appUpdates', 'app_updates');
