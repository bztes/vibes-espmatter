/**
 * Accounts and sessions. Passwords: scrypt (node:crypto). Sessions: a random cookie value, stored
 * as its SHA-256 so a leaked database doesn't leak sessions. The first account becomes admin.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { error, type Cookies } from '@sveltejs/kit';
import { and, count, eq, gt, lt } from 'drizzle-orm';
import { dev } from '$app/env';
import { getRequestEvent } from '$app/server';
import { db } from './db/index.ts';
import { session, user, type Role } from './db/schema.ts';
import { getSetting } from './settings.ts';

const scryptAsync = promisify(scrypt) as (
	pw: string,
	salt: Buffer,
	len: number,
	opts: object
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'espm_session';
const SESSION_DAYS = 30;

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	role: Role;
	/** Signed in with a generated password: may only change it (`locals.passwordChange`). */
	mustChangePassword: boolean;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await scryptAsync(password, salt, 32, SCRYPT);
	return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
	return timingSafeEqual(key, expected);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function userCount(): Promise<number> {
	const [row] = await db.select({ n: count() }).from(user);
	return row.n;
}

/** Sign-up is open while there is no account (whoever sets up the server becomes admin), then if allowed. */
export async function signUpOpen(): Promise<boolean> {
	return (await userCount()) === 0 || (await getSetting('signUpEnabled'));
}

export async function createUser(input: {
	email: string;
	name: string;
	password: string;
	role?: Role;
	mustChangePassword?: boolean;
}) {
	const first = (await userCount()) === 0;
	const [row] = await db
		.insert(user)
		.values({
			email: input.email.toLowerCase(),
			name: input.name,
			passwordHash: await hashPassword(input.password),
			role: first ? 'admin' : (input.role ?? 'user'),
			mustChangePassword: input.mustChangePassword ?? false
		})
		.returning();
	return row;
}

export async function startSession(cookies: Cookies, userId: string) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
	await db.insert(session).values({ id: sha256(token), userId, expiresAt });
	await db.update(user).set({ lastLoginAt: new Date() }).where(eq(user.id, userId));
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		expires: expiresAt
	});
}

export async function endSession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await db.delete(session).where(eq(session.id, sha256(token)));
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function endAllSessions(userId: string) {
	await db.delete(session).where(eq(session.userId, userId));
}

/** The user of a session cookie, if valid and not disabled. */
export async function sessionUser(token: string | undefined): Promise<SessionUser | undefined> {
	if (!token) return undefined;
	const [row] = await db
		.select({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			disabled: user.disabled,
			mustChangePassword: user.mustChangePassword
		})
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(and(eq(session.id, sha256(token)), gt(session.expiresAt, new Date())))
		.limit(1);
	if (!row || row.disabled) return undefined;
	const { id, email, name, role, mustChangePassword } = row;
	return { id, email, name, role, mustChangePassword };
}

export async function pruneSessions() {
	await db.delete(session).where(lt(session.expiresAt, new Date()));
}

/**
 * A new password for an account. `generated`: made up for the user (shown once to an admin), who
 * must change it at the next sign-in. Ends the account's sessions either way.
 */
export async function setPassword(userId: string, password: string, generated: boolean) {
	await db
		.update(user)
		.set({ passwordHash: await hashPassword(password), mustChangePassword: generated })
		.where(eq(user.id, userId));
	await endAllSessions(userId);
}

/**
 * In remote functions and endpoints: the signed-in user, or 401. Someone who still has to change a
 * generated password isn't signed in yet (`locals.passwordChange` instead).
 */
export function requireUser(): SessionUser {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Please sign in.');
	return locals.user;
}

/** Admin only: everyone else gets a 404, as if it didn't exist. */
export function requireAdmin(): SessionUser {
	const u = requireUser();
	if (u.role !== 'admin') error(404, 'Not found');
	return u;
}
