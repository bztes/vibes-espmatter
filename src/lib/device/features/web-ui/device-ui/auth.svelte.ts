import { api, setUnauthorizedHandler } from './api';

export interface Session {
	authenticated: boolean;
	user: string;
	role: 'admin' | 'user' | 'none';
	/** Logged in with an initial or reset password: everything else is locked until it's changed. */
	mustChangePassword: boolean;
	/** Password protection is configured (otherwise everyone is admin). */
	authEnabled: boolean;
}

/** The logged-in user of this page; `undefined` until the device answered. */
export const auth = $state<{ session?: Session }>({});

export async function checkSession() {
	auth.session = await api<Session>('/api/auth/me');
}

export async function login(user: string, password: string) {
	auth.session = await api<Session>('/api/auth/login', { body: { user, password } });
}

export async function changePassword(current: string, password: string) {
	auth.session = await api<Session>('/api/auth/password', { body: { current, password } });
}

export async function logout() {
	await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
	location.reload(); // drop all state of the previous user
}

setUnauthorizedHandler(() => {
	if (auth.session?.authenticated) auth.session = { ...auth.session, authenticated: false };
});
