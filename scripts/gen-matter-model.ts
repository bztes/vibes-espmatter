/**
 * Writes `src/lib/sdk/matter-model.ts` from connectedhomeip's `controller-clusters.matter` at
 * CHIP_COMMIT. Run by hand after bumping it: `pnpm gen:matter`.
 */
import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { CHIP_COMMIT } from '../src/lib/core/matter-version.ts';

const SOURCE = `https://raw.githubusercontent.com/espressif/connectedhomeip/${CHIP_COMMIT}/src/controller/data_model/controller-clusters.matter`;
const OUT = new URL('../src/lib/sdk/matter-model.ts', import.meta.url);

/** IDL scalar types → esp-matter's JSON TLV tags (`{"0:U8": 4}`). */
const SCALARS: Record<string, string> = {
	boolean: 'BOOL',
	single: 'FP',
	double: 'DFP',
	char_string: 'STR',
	long_char_string: 'STR',
	octet_string: 'BYT',
	long_octet_string: 'BYT',
	enum8: 'U8',
	bitmap8: 'U8',
	percent: 'U8',
	fabric_idx: 'U8',
	action_id: 'U8',
	status: 'U8',
	enum16: 'U16',
	bitmap16: 'U16',
	percent100ths: 'U16',
	vendor_id: 'U16',
	group_id: 'U16',
	endpoint_no: 'U16',
	temperature: 'I16',
	bitmap32: 'U32',
	elapsed_s: 'U32',
	epoch_s: 'U32',
	utc: 'U32',
	command_id: 'U32',
	attrib_id: 'U32',
	cluster_id: 'U32',
	devtype_id: 'U32',
	field_id: 'U32',
	data_ver: 'U32',
	trans_id: 'U32',
	bitmap64: 'U64',
	node_id: 'U64',
	fabric_id: 'U64',
	event_no: 'U64',
	epoch_us: 'U64',
	systime_ms: 'U64',
	systime_us: 'U64',
	posix_ms: 'U64',
	power_mw: 'I64',
	power_mva: 'I64',
	power_mvar: 'I64',
	energy_mwh: 'I64',
	energy_mvah: 'I64',
	energy_mvarh: 'I64',
	amperage_ma: 'I64',
	voltage_mv: 'I64',
	money: 'I64'
};

function intType(t: string): string | undefined {
	const m = /^int(\d+)([us])$/.exec(t);
	if (!m) return;
	const bits = [8, 16, 32, 64].find((b) => b >= Number(m[1]));
	return `${m[2] === 'u' ? 'U' : 'I'}${bits}`;
}

interface Field {
	name: string;
	id: number;
	type: string; // IDL type
	list: boolean;
	optional: boolean;
	nullable: boolean;
}
interface Named {
	kind: 'enum' | 'bitmap';
	name: string;
	base: string;
	items: [string, number][];
}
interface Cluster {
	name: string;
	id: number;
	revision?: number;
	named: Named[];
	structs: Map<string, Field[]>;
	attributes: (Field & { writable: boolean; timed: boolean })[];
	commands: { name: string; id: number; request: string; timed: boolean }[];
	events: { name: string; id: number }[];
}

const QUALIFIERS =
	/^(?:(?:readonly|attribute|optional|nullable|fabric_sensitive|provisional|timedwrite|writeonly|access\([^)]*\))\s+)*/;

function field(line: string): Field | undefined {
	const quals = QUALIFIERS.exec(line)![0];
	const m = /^(\w+)(?:<\d+>)?\s+(\w+)(\[\])?\s*=\s*(\d+);$/.exec(line.slice(quals.length));
	if (!m) return;
	return {
		type: m[1],
		name: m[2],
		list: !!m[3],
		id: Number(m[4]),
		optional: /\boptional\b/.test(quals),
		nullable: /\bnullable\b/.test(quals)
	};
}

function parse(text: string) {
	const lines = text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	const shared: Named[] = [];
	const clusters: Cluster[] = [];
	let cluster: Cluster | undefined;
	let block: { named?: Named; fields?: Field[]; skip?: boolean } | undefined;

	for (const line of lines) {
		if (block) {
			if (line === '}') block = undefined;
			else if (block.named) {
				const m = /^(\w+)\s*=\s*(0x[0-9a-fA-F]+|\d+);$/.exec(line);
				if (m) block.named.items.push([m[1], Number(m[2])]);
			} else if (block.fields) {
				const f = field(line);
				if (f) block.fields.push(f);
			}
			continue;
		}
		let m = /^(?:shared\s+)?(enum|bitmap)\s+(\w+)\s*:\s*(\w+)\s*\{$/.exec(line);
		if (m) {
			const named: Named = { kind: m[1] as Named['kind'], name: m[2], base: m[3], items: [] };
			(cluster ? cluster.named : shared).push(named);
			block = { named };
			continue;
		}
		m =
			/^(?:(?:shared|fabric_scoped|request|response)\s+)*struct\s+(\w+)(?:\s*=\s*\d+)?\s*\{$/.exec(
				line
			);
		if (m) {
			const fields: Field[] = [];
			cluster?.structs.set(m[1], fields);
			block = { fields };
			continue;
		}
		m = /^((?:\w+\s+)*)cluster\s+(\w+)\s*=\s*(\d+)\s*\{$/.exec(line);
		if (m) {
			cluster = {
				name: m[2],
				id: Number(m[3]),
				named: [],
				structs: new Map(),
				attributes: [],
				commands: [],
				events: []
			};
			// Test and deprecated clusters: parsed (to skip their blocks), not written.
			if (!/\b(internal|deprecated)\b/.test(m[1]) && cluster.id < 0xfff10000)
				clusters.push(cluster);
			continue;
		}
		if (!cluster) continue;
		if (line === '}') {
			cluster = undefined;
			continue;
		}
		m = /\bevent\s+(?:access\([^)]*\)\s+)?(\w+)\s*=\s*(\d+)\s*\{$/.exec(line);
		if (m) {
			cluster.events.push({ name: m[1], id: Number(m[2]) });
			block = { skip: true };
			continue;
		}
		m =
			/^((?:\w+\s+)*)command\s+(?:access\([^)]*\)\s+)?(\w+)\((\w*)\)\s*:\s*\w+\s*=\s*(\d+);$/.exec(
				line
			);
		if (m) {
			cluster.commands.push({
				name: m[2],
				id: Number(m[4]),
				request: m[3],
				timed: /\btimed\b/.test(m[1])
			});
			continue;
		}
		m = /^revision\s+(\d+);$/.exec(line);
		if (m) {
			cluster.revision = Number(m[1]);
			continue;
		}
		if (/\battribute\b/.test(line)) {
			const f = field(line);
			if (!f) throw new Error(`can't parse: ${line}`);
			cluster.attributes.push({
				...f,
				writable: !/\breadonly\b/.test(line),
				timed: /\btimedwrite\b/.test(line)
			});
			continue;
		}
		if (line.includes('{')) block = { skip: true };
	}
	return { shared, clusters };
}

const camel = (s: string) => s.replace(/^[A-Z]+(?=[A-Z][a-z]|\d|$)|^[A-Z]/, (p) => p.toLowerCase());
/** `kHeat` → `heat`. */
const member = (s: string) => camel(s.replace(/^k(?=[A-Z0-9])/, ''));
const key = (s: string) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : JSON.stringify(s));
const hex = (n: number, pad = 4) => `0x${n.toString(16).padStart(pad, '0')}`;

function generate({ shared, clusters }: ReturnType<typeof parse>) {
	const sharedBase = new Map(shared.map((n) => [n.name, n.base]));
	const unknown = new Set<string>();

	const tlv = (c: Cluster, f: Field) => {
		if (f.list) return 'ARR';
		const local = c.named.find((n) => n.name === f.type)?.base ?? sharedBase.get(f.type);
		const t = SCALARS[local ?? f.type] ?? intType(local ?? f.type);
		if (t) return t;
		if (c.structs.has(f.type) || /Struct$|^[A-Z]/.test(f.type)) return 'OBJ';
		unknown.add(f.type);
		return '?';
	};
	const fieldEntry = (c: Cluster, f: Field, extra = '') => {
		const props = [`id: ${f.id}`, `type: '${tlv(c, f)}'`];
		const named = c.named.find((n) => n.name === f.type) ?? shared.find((n) => n.name === f.type);
		if (named && !f.list) props.push(`${named.kind}: '${named.name}'`);
		if (f.list) props.push('list: true');
		if (f.nullable) props.push('nullable: true');
		if (f.optional) props.push('optional: true');
		return `${key(f.name)}: { ${props.join(', ')}${extra} }`;
	};
	const namedBlock = (list: Named[]) =>
		list
			.map(
				(n) =>
					`${key(n.name)}: { ${n.items.map(([k, v]) => `${key(member(k))}: ${v}`).join(', ')} }`
			)
			.join(',\n');

	const out: string[] = [
		`/**
 * Matter clusters: IDs, attribute and command field types (esp-matter's JSON TLV tags), enums and
 * features. Generated by \`pnpm gen:matter\` from connectedhomeip ${CHIP_COMMIT.slice(0, 10)} – don't edit.
 */

export const SHARED = {
	enums: { ${namedBlock(shared.filter((n) => n.kind === 'enum'))} },
	bitmaps: { ${namedBlock(shared.filter((n) => n.kind === 'bitmap'))} }
} as const;
`
	];

	for (const c of clusters) {
		const features = c.named.find((n) => n.kind === 'bitmap' && n.name === 'Feature');
		const enums = c.named.filter((n) => n.kind === 'enum');
		const bitmaps = c.named.filter((n) => n.kind === 'bitmap' && n !== features);
		const attributes = c.attributes
			.filter((a) => a.id < 0xfff8)
			.map((a) => {
				const extra = (a.writable ? ', writable: true' : '') + (a.timed ? ', timed: true' : '');
				return fieldEntry(c, a, extra).replace(/id: (\d+)/, (_, id) => `id: ${hex(Number(id))}`);
			});
		const commands = c.commands.map((cmd) => {
			const fields = (c.structs.get(cmd.request) ?? []).map((f) => fieldEntry(c, f));
			return `${key(camel(cmd.name))}: { id: ${hex(cmd.id, 2)}${cmd.timed ? ', timed: true' : ''}, fields: { ${fields.join(', ')} } }`;
		});
		out.push(`export const ${c.name} = {
	id: ${hex(c.id)},
	${c.revision != null ? `revision: ${c.revision},` : ''}
	features: { ${features ? features.items.map(([k, v]) => `${key(member(k))}: ${hex(v, 1)}`).join(', ') : ''} },
	attributes: { ${attributes.join(',\n')} },
	commands: { ${commands.join(',\n')} },
	events: { ${c.events.map((e) => `${key(camel(e.name))}: ${e.id}`).join(', ')} },
	enums: { ${namedBlock(enums)} },
	bitmaps: { ${namedBlock(bitmaps)} }
} as const;
`);
	}

	out.push(`/** IDL cluster names by ID, e.g. \`0x0201\` → \`Thermostat\`. */
export const IDL_NAMES: Record<number, string> = {
	${clusters.map((c) => `${hex(c.id)}: '${c.name}'`).join(',\n')}
};
`);
	if (unknown.size) console.warn('Unknown types, mapped to "?":', [...unknown].join(', '));
	return out.join('\n');
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
const model = parse(await res.text());
const code = generate(model);
const options = await resolveConfig(OUT.pathname);
await writeFile(OUT, await format(code, { ...options, filepath: OUT.pathname }));
console.log(`Wrote ${OUT.pathname}: ${model.clusters.length} clusters`);
