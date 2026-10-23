/** Admin only (`requireAdmin`): server settings and the build workers that compile the firmware. */
import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { getSignUpOpen } from '#lib/api/auth.remote.ts';
import { getCanBuild } from '#lib/api/builds.remote.ts';
import { errorMessage } from '#lib/errors.ts';
import { requireAdmin } from '#lib/server/auth.ts';
import { getSetting, setSetting } from '#lib/server/settings.ts';
import {
	deleteWorker as removeWorker,
	listWorkers,
	saveWorker as storeWorker,
	testWorker as runTest
} from '#lib/server/builder/index.ts';

const id = v.pipe(v.string(), v.uuid());
const text = (message: string) => v.pipe(v.string(), v.trim(), v.nonEmpty(message));

const common = {
	id: v.optional(id),
	name: v.pipe(text('Please enter a name.'), v.maxLength(48)),
	enabled: v.boolean()
};

const maxWorkspaces = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1, 'Keep at least 1 workspace.'),
	v.maxValue(100)
);

/** One entry per `WorkerKind`, validating its `config`. */
const workerSchema = v.variant('kind', [
	v.object({
		...common,
		kind: v.literal('idf-docker'),
		config: v.object({
			url: v.pipe(
				text('Please enter the worker URL.'),
				v.url('Please enter a URL like http://idf:3001.')
			),
			maxWorkspaces
		})
	}),
	v.object({
		...common,
		kind: v.literal('idf-local'),
		config: v.object({
			idfPath: text('Please enter the ESP-IDF path.'),
			idfPython: v.pipe(
				v.optional(v.string(), ''),
				v.trim(),
				v.transform((p) => p || undefined)
			),
			maxWorkspaces
		})
	})
]);

export type WorkerInput = v.InferInput<typeof workerSchema>;

/** Whether anyone can create an account (see `canSignUp`). */
export const getSignUpEnabled = query(async () => {
	requireAdmin();
	return getSetting('signUpEnabled');
});

export const setSignUpEnabled = command(v.boolean(), async (enabled) => {
	requireAdmin();
	await setSetting('signUpEnabled', enabled);
	void getSignUpEnabled().refresh();
	void getSignUpOpen().refresh();
});

export const getWorkers = query(async () => {
	requireAdmin();
	return listWorkers();
});

/** Adds a worker (without `id`) or replaces one. */
export const saveWorker = command(workerSchema, async (input) => {
	requireAdmin();
	if (!(await storeWorker(input))) error(404, 'Build worker not found');
	void getWorkers().refresh();
	void getCanBuild().refresh();
});

export const deleteWorker = command(id, async (workerId) => {
	requireAdmin();
	try {
		await removeWorker(workerId);
	} catch (err) {
		error(409, errorMessage(err));
	}
	void getWorkers().refresh();
	void getCanBuild().refresh();
});

/** Checks that a saved worker is reachable and works. */
export const testWorker = command(id, async (workerId) => {
	requireAdmin();
	const result = await runTest(workerId);
	if (!result) error(404, 'Build worker not found');
	return result;
});
