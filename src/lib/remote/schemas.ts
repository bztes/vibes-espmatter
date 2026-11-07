import * as v from 'valibot';
import { normalize } from '#lib/core/engine.ts';

export const uuid = v.pipe(v.string(), v.uuid());

/** Shape check only – `normalize` coerces, fills defaults and drops the rest. */
export const firmwareConfig = v.pipe(
	v.looseObject({ kind: v.picklist(['hub', 'device']), name: v.string() }),
	v.transform((input) => normalize(input))
);

/** Shape check only – `normalizeDevice` (with the device's firmware) does the rest. */
export const deviceSettings = v.looseObject({
	matter: v.optional(v.looseObject({})),
	updates: v.optional(v.looseObject({})),
	plugins: v.optional(v.record(v.string(), v.looseObject({})))
});

export const deviceName = v.pipe(
	v.string(),
	v.trim(),
	v.nonEmpty('Give it a name.'),
	v.maxLength(48)
);

export const email = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.email('Please enter a valid email address.')
);
export const password = v.pipe(
	v.string(),
	v.minLength(8, 'At least 8 characters.'),
	v.maxLength(128)
);
export const name = v.pipe(
	v.string(),
	v.trim(),
	v.nonEmpty('Please enter a name.'),
	v.maxLength(64)
);
