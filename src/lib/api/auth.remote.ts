import * as v from 'valibot';
import { invalid, redirect } from '@sveltejs/kit';
import { form, getRequestEvent, query } from '$app/server';
import { APIError } from 'better-auth/api';
import { auth, canSignUp, isAdmin } from '#lib/server/auth.ts';

/** Only allow redirects to local paths. */
function safeRedirect(target: string | undefined) {
	return target && target.startsWith('/') && !target.startsWith('//') ? target : '/';
}

export const getUser = query(async () => {
	const { locals } = getRequestEvent();
	return locals.user
		? {
				id: locals.user.id,
				name: locals.user.name,
				email: locals.user.email,
				admin: isAdmin(locals.user)
			}
		: null;
});

/** Whether an account can be created (always while there is no admin, then if an admin allows it). */
export const getSignUpOpen = query(() => canSignUp());

export const signIn = form(
	v.object({
		email: v.pipe(v.string(), v.trim(), v.email('Please enter a valid email address.')),
		_password: v.pipe(v.string(), v.nonEmpty('Please enter your password.')),
		redirectTo: v.optional(v.string())
	}),
	async ({ email, _password, redirectTo }) => {
		try {
			await auth.api.signInEmail({ body: { email, password: _password } });
		} catch (error) {
			if (error instanceof APIError) invalid(error.message || 'Sign in failed.');
			throw error;
		}
		redirect(303, safeRedirect(redirectTo));
	}
);

export const signUp = form(
	v.object({
		name: v.pipe(v.string(), v.trim(), v.nonEmpty('Please enter your name.'), v.maxLength(64)),
		email: v.pipe(v.string(), v.trim(), v.email('Please enter a valid email address.')),
		_password: v.pipe(v.string(), v.minLength(8, 'Password must be at least 8 characters.')),
		redirectTo: v.optional(v.string())
	}),
	async ({ name, email, _password, redirectTo }) => {
		if (!(await canSignUp())) invalid('Sign-up is closed.');
		try {
			await auth.api.signUpEmail({ body: { name, email, password: _password } });
		} catch (error) {
			if (error instanceof APIError) invalid(error.message || 'Registration failed.');
			throw error;
		}
		redirect(303, safeRedirect(redirectTo));
	}
);

export const signOut = form(async () => {
	const { request } = getRequestEvent();
	await auth.api.signOut({ headers: request.headers });
	redirect(303, '/');
});
