/**
 * Compiles the device web interface (shell + the widgets of a device) with Vite into one gzipped
 * HTML file that the firmware embeds as `main/ui.html.gz`. Sources come from `sources.ts` and are
 * written to a scratch directory; results are cached by content.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin, Rolldown } from 'vite';
import type { Assembly } from '#lib/core/assemble.ts';
import { uiSources } from './sources.ts';

export interface UiSpec {
	device: { name: string; kind: 'hub' | 'device' };
	pages: { id: string; title: string; path: string; icon?: string; menu?: boolean }[];
	widgets: {
		page: string;
		title: string;
		wide?: boolean;
		tab?: string;
		plain?: boolean;
		access?: 'admin' | 'account';
		props: Record<string, unknown>;
		module: string;
	}[];
}

export function uiSpec(a: Assembly): UiSpec {
	return {
		device: { name: a.resolved.config.name, kind: a.resolved.config.kind },
		pages: a.pages.map(({ id, title, path, icon, menu }) => ({ id, title, path, icon, menu })),
		widgets: a.widgets.map((w) => ({
			page: w.page,
			title: w.title,
			wide: w.wide,
			tab: w.tab,
			plain: w.plain,
			access: w.access,
			props: w.props ?? {},
			module: `${w.dir}/ui/${w.file}`
		}))
	};
}

function entry(spec: UiSpec): string {
	const modules = [...new Set(spec.widgets.map((w) => w.module))];
	const icons = [...new Set(spec.pages.flatMap((p) => (p.icon ? [p.icon] : [])))].filter((i) =>
		/^[a-z0-9-]+$/.test(i)
	);
	const mod = (m: string) => `W${modules.indexOf(m)}`;
	const icon = (i: string) => `I${icons.indexOf(i)}`;
	return `// Generated – device web interface entry.
import { mount } from 'svelte';
import './main.css';
import Shell from './src/lib/device-ui/Shell.svelte';
${modules.map((m) => `import ${mod(m)} from './${m}';`).join('\n')}
${icons.map((i) => `import ${icon(i)} from '@lucide/svelte/icons/${i}';`).join('\n')}

mount(Shell, {
	target: document.getElementById('app'),
	props: {
		device: ${JSON.stringify(spec.device)},
		pages: [${spec.pages.map(({ icon: i, ...p }) => `{ ...${JSON.stringify(p)}${i && icons.includes(i) ? `, icon: ${icon(i)}` : ''} }`).join(', ')}],
		widgets: [
${spec.widgets.map(({ module, ...w }) => `\t\t\t{ ...${JSON.stringify(w)}, component: ${mod(module)} }`).join(',\n')}
		]
	}
});
`;
}

const css = (spec: UiSpec, tailwindDir: string) => {
	const dirs = new Set([
		'src/lib/device-ui',
		'src/lib/sdk/device-ui',
		...spec.widgets.map((w) => path.posix.dirname(w.module))
	]);
	return `@layer theme, base, components, utilities;
@import '${tailwindDir}/theme.css' layer(theme);
@import '${tailwindDir}/preflight.css' layer(base);
@import '${tailwindDir}/utilities.css' layer(utilities) source(none);
@import './src/lib/sdk/device-ui/theme.css';
${[...dirs].map((d) => `@source './${d}';`).join('\n')}
`;
};

const html = (spec: UiSpec) => {
	const title = spec.device.name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title}</title>
		<script type="module" src="/main.ts"></script>
	</head>
	<body><div id="app"></div></body>
</html>
`;
};

/** Inline the JS and CSS: the ESP serves exactly one file. */
function inline(): Plugin {
	const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return {
		name: 'espm-inline',
		enforce: 'post',
		generateBundle(_o, bundle: Rolldown.OutputBundle) {
			const page = bundle['index.html'] as Rolldown.OutputAsset;
			let out = String(page.source);
			for (const [file, chunk] of Object.entries(bundle)) {
				if (chunk.type === 'chunk') {
					const code = chunk.code.replaceAll('</script', '<\\/script');
					out = out.replace(
						new RegExp(`<script[^>]*src="[^"]*${escape(file)}"[^>]*></script>`),
						() => `<script type="module">${code}</script>`
					);
					delete bundle[file];
				} else if (file.endsWith('.css')) {
					out = out.replace(
						new RegExp(`<link[^>]*href="[^"]*${escape(file)}"[^>]*>`),
						() => `<style>${String(chunk.source)}</style>`
					);
					delete bundle[file];
				}
			}
			page.source = out;
		}
	};
}

export async function buildDeviceUi(
	spec: UiSpec,
	cacheDir: string,
	log: (line: string) => void
): Promise<Buffer> {
	const sources = Object.fromEntries(
		await Promise.all(
			Object.entries(uiSources).map(async ([file, load]) => [file.slice(1), await load()] as const)
		)
	);
	for (const w of spec.widgets)
		if (!(w.module in sources)) throw new Error(`Widget not found: ${w.module}`);

	const nodeModules = path.resolve('node_modules');
	const tailwindDir = await fs.realpath(path.join(nodeModules, 'tailwindcss'));
	const key = createHash('sha256')
		.update(JSON.stringify({ spec, sources, tailwindDir }))
		.digest('hex')
		.slice(0, 16);
	const cached = path.join(cacheDir, `${key}.html.gz`);
	if (existsSync(cached)) {
		log(`Web interface unchanged (${key})`);
		return fs.readFile(cached);
	}

	log(
		`Building web interface: ${spec.pages.map((p) => p.title).join(', ')} (${spec.widgets.length} widgets)…`
	);
	const started = Date.now();
	await fs.mkdir(cacheDir, { recursive: true });
	const work = await fs.mkdtemp(path.join(cacheDir, 'build-'));
	try {
		for (const [file, content] of Object.entries(sources)) {
			await fs.mkdir(path.dirname(path.join(work, file)), { recursive: true });
			await fs.writeFile(path.join(work, file), content);
		}
		await fs.writeFile(path.join(work, 'main.ts'), entry(spec));
		await fs.writeFile(path.join(work, 'main.css'), css(spec, tailwindDir));
		await fs.writeFile(path.join(work, 'index.html'), html(spec));
		await fs.symlink(nodeModules, path.join(work, 'node_modules'));

		const { build } = await import('vite');
		const { svelte } = await import('@sveltejs/vite-plugin-svelte');
		const { default: tailwindcss } = await import('@tailwindcss/vite');
		await build({
			root: work,
			configFile: false,
			logLevel: 'warn',
			resolve: {
				alias: [
					{
						find: /^#sdk\/device-ui$/,
						replacement: path.join(work, 'src/lib/sdk/device-ui/index.ts')
					},
					{ find: /^#sdk\/(.*)$/, replacement: path.join(work, 'src/lib/sdk/$1') }
				]
			},
			plugins: [
				tailwindcss(),
				svelte({ configFile: false, compilerOptions: { runes: true } }),
				inline()
			],
			build: {
				outDir: 'dist',
				target: 'es2020',
				cssCodeSplit: false,
				modulePreload: false,
				assetsInlineLimit: Number.MAX_SAFE_INTEGER,
				rolldownOptions: { output: { codeSplitting: false } }
			}
		});
		const out = await fs.readFile(path.join(work, 'dist/index.html'));
		const gz = gzipSync(out, { level: 9 });
		await fs.writeFile(cached, gz);
		log(
			`Web interface built in ${((Date.now() - started) / 1000).toFixed(1)} s (${(out.length / 1024).toFixed(0)} KB, ${(gz.length / 1024).toFixed(0)} KB gzipped)`
		);
		return gz;
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}
