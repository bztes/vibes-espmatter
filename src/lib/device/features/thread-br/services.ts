import { defineFirmwareApi } from '../../services';

/** The Thread network (`espm_thread.h`): for features whose firmware uses it. */
export const threadNetwork = defineFirmwareApi('thread_br.network', 'thread_br');
