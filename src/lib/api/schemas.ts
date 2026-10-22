import * as v from 'valibot';
import { MAX_CHIPS, normalizeProject } from '#lib/device/generator.ts';

const featureConfig = v.record(v.string(), v.union([v.string(), v.number(), v.boolean()]));

/** Shape check only – `normalizeProject` coerces and fills in the details. */
export const projectConfigSchema = v.pipe(
	v.object({
		version: v.literal(2),
		name: v.pipe(v.string(), v.maxLength(48)),
		template: v.optional(v.string()),
		chips: v.pipe(
			v.array(
				v.object({
					id: v.pipe(v.string(), v.maxLength(24)),
					name: v.pipe(v.string(), v.maxLength(32)),
					board: v.string(),
					features: v.record(v.string(), featureConfig)
				})
			),
			v.minLength(1),
			v.maxLength(MAX_CHIPS)
		)
	}),
	v.transform((input) => normalizeProject(input))
);
