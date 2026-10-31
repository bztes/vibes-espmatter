import type { Story } from '../../stories';
import OtaPanel from './device-ui/OtaPanel.svelte';

// The upload itself goes through XHR, which isn't mocked.
export default [{ name: 'Update', component: OtaPanel }] satisfies Story[];
