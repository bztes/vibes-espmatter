import { chipFeatures, requiredFeatures, softDependencies } from './generator';
import type { FeatureDef, ProjectConfig } from './types';

export interface GraphNode {
	/** `chip:feature` */
	key: string;
	chip: string;
	feature: FeatureDef;
	/** 0 = relies on nothing on its board; otherwise one more than its deepest requirement. */
	depth: number;
}

export interface GraphEdge {
	/** The feature that relies on `to`. */
	from: string;
	to: string;
	/**
	 * `requires`: on the same board (`requiredFeatures`). `soft`: works with it when it is on the
	 * same board (`softDependencies`). `link`: works with a feature of another board.
	 */
	kind: 'requires' | 'soft' | 'link';
	label?: string;
}

const key = (chip: string, feature: string) => `${chip}:${feature}`;

/**
 * What relies on what in a device: `requires` and `soft` within each board, plus the links between
 * boards (a feature talking to its counterpart over a UART). Only `requires` sets the depth: soft
 * dependencies can point either way.
 */
export function dependencyGraph(project: ProjectConfig): {
	nodes: GraphNode[];
	edges: GraphEdge[];
} {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const softByChip = softDependencies(project);

	for (const chip of project.chips) {
		const present = chipFeatures(chip);
		const ids = new Set(present.map((f) => f.id));
		const depth = new Map<string, number>();
		const depthOf = (f: FeatureDef, seen = new Set<string>()): number => {
			if (depth.has(f.id)) return depth.get(f.id)!;
			if (seen.has(f.id)) return 0; // a cycle: stop rather than recurse forever
			seen.add(f.id);
			const reqs = requiredFeatures(f).filter((r) => ids.has(r));
			const d = reqs.length
				? 1 +
					Math.max(
						...reqs.map((r) =>
							depthOf(
								present.find((p) => p.id === r)!,
								seen
							)
						)
					)
				: 0;
			depth.set(f.id, d);
			return d;
		};
		const soft = softByChip.get(chip.id);
		for (const f of present) {
			for (const s of soft?.get(f.id) ?? [])
				edges.push({ from: key(chip.id, f.id), to: key(chip.id, s), kind: 'soft' });
			nodes.push({ key: key(chip.id, f.id), chip: chip.id, feature: f, depth: depthOf(f) });
			for (const r of requiredFeatures(f)) {
				if (ids.has(r))
					edges.push({ from: key(chip.id, f.id), to: key(chip.id, r), kind: 'requires' });
			}
		}
	}

	const has = (chip: string, feature: string) => nodes.some((n) => n.key === key(chip, feature));

	// A board's feature that the other end of its UART talks to (e.g. Thread border router → radio).
	for (const chip of project.chips) {
		for (const f of chipFeatures(chip)) {
			const link = f.link;
			if (!link) continue;
			for (const other of project.chips) {
				if (other.id !== chip.id && has(other.id, link)) {
					edges.push({
						from: key(other.id, link),
						to: key(chip.id, f.id),
						kind: 'link'
					});
				}
			}
		}
	}

	return { nodes, edges };
}
