import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Settings from '@lucide/svelte/icons/settings';
import type { Story } from '../../stories';
import ChangePassword from './device-ui/ChangePassword.svelte';
import Header from './device-ui/Header.svelte';
import Login from './device-ui/Login.svelte';
import type { DeviceInfo } from './device-ui/types';

/** The device of the layout stories: a hub with a dashboard and a setup page. */
export const device: DeviceInfo = {
	name: 'Matter Hub',
	typeName: 'Matter Thread Hub',
	roleName: 'Host',
	pages: [
		{ id: 'dashboard', path: '/', title: 'Dashboard', access: 'user', icon: LayoutDashboard },
		{ id: 'admin', path: '/admin', title: 'Setup', access: 'admin', icon: Settings }
	]
};

export default [
	{
		name: 'Login',
		component: Login,
		props: { device },
		session: { authenticated: false, user: '', role: 'none' },
		wide: true
	},
	{ name: 'Change password', component: ChangePassword },
	{
		name: 'Change password (forced)',
		component: ChangePassword,
		props: { forced: true },
		session: { mustChangePassword: true }
	},
	{ name: 'Header', component: Header, props: { device, page: 'admin' }, wide: true },
	{
		name: 'Header (user)',
		component: Header,
		props: { device, page: 'dashboard' },
		session: { user: 'anna', role: 'user' },
		wide: true
	}
] satisfies Story[];
