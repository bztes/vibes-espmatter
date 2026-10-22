/**
 * The unsaved new project (one per browser), kept in localStorage until it is saved. Storage may be
 * unavailable or hold a broken draft – then there is none.
 */
import { normalizeProject } from '#lib/device/generator.ts';
import type { ProjectConfig } from '#lib/device/types.ts';

const KEY = 'mesp:draft';

export function readDraft(): ProjectConfig | null {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? normalizeProject(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

export function writeDraft(project: ProjectConfig) {
	try {
		localStorage.setItem(KEY, JSON.stringify(project));
	} catch {
		// storage unavailable
	}
}

export function clearDraft() {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// storage unavailable
	}
}
