import * as v from 'valibot';
import { invalid, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { form, getRequestEvent, query } from '$app/server';
import {
	createUser,
	endSession,
	setPassword,
	signUpOpen,
	startSession,
	userCount,
	verifyPassword
} from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { email, name, password } from './schemas.ts';

const safeRedirect = (to?: string) => (to && to.startsWith('/') && !to.startsWith('//') ? to : '/');

export const getMe = query(async () => {
	const { locals } = getRequestEvent();
	return locals.user ?? null;
});

export const getSignUp = query(async () => ({
	open: await signUpOpen(),
	first: (await userCount()) === 0
}));

export const signIn = form(
	v.object({
		email,
		_password: v.pipe(v.string(), v.nonEmpty('Please enter your password.')),
		redirectTo: v.optional(v.string())
	}),
	async ({ email, _password, redirectTo }) => {
		const [row] = await db.select().from(user).where(eq(user.email, email));
		// Same work and answer whether or not the account exists.
		const ok = row
			? await verifyPassword(_password, row.passwordHash)
			: (await verifyPassword(_password, 'scrypt$AAAA$AAAA'), false);
		if (!row || !ok) invalid('Email or password is wrong.');
		if (row.disabled) invalid('This account is disabled – ask an admin.');
		await startSession(getRequestEvent().cookies, row.id);
		const to = safeRedirect(redirectTo);
		if (row.mustChangePassword) redirect(303, `/password?redirectTo=${encodeURIComponent(to)}`);
		redirect(303, to);
	}
);

/** Who may change their password: the signed-in user, or one who must change a generated one. */
export const getPasswordChange = query(async () => {
	const { locals } = getRequestEvent();
	const u = locals.user ?? locals.passwordChange;
	return u ? { email: u.email, forced: !locals.user } : null;
});

/**
 * Change your own password (needs the current one). Ends your other sessions. Form-level issues:
 * the password fields are cleared after a failed submit, so field issues would be replaced by
 * "required" ones.
 */
export const changePassword = form(
	v.object({
		_current: v.pipe(v.string(), v.nonEmpty('Please enter your current password.')),
		_password: password,
		_confirm: v.string(),
		redirectTo: v.optional(v.string())
	}),
	async ({ _current, _password, _confirm, redirectTo }) => {
		const { locals, cookies } = getRequestEvent();
		const me = locals.user ?? locals.passwordChange;
		if (!me) redirect(303, '/login');
		const [row] = await db.select().from(user).where(eq(user.id, me.id));
		if (!row || !(await verifyPassword(_current, row.passwordHash)))
			invalid('That’s not your current password.');
		if (_password === _current) invalid('Choose a password different from the current one.');
		if (_password !== _confirm) invalid('The new passwords don’t match.');
		await setPassword(me.id, _password, false);
		await startSession(cookies, me.id);
		redirect(303, safeRedirect(redirectTo));
	}
);

export const signUp = form(
	v.object({ name, email, _password: password, redirectTo: v.optional(v.string()) }),
	async ({ name, email, _password, redirectTo }, issue) => {
		if (!(await signUpOpen())) invalid('Sign-up is closed – ask an admin for an account.');
		const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
		if (existing) invalid(issue.email('An account with this email exists.'));
		const created = await createUser({ email, name, password: _password });
		await startSession(getRequestEvent().cookies, created.id);
		redirect(303, safeRedirect(redirectTo));
	}
);

export const signOut = form(async () => {
	await endSession(getRequestEvent().cookies);
	redirect(303, '/login');
});
