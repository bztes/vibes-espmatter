/**
 * Compiles a role's device web interface (layout + panels, see `DeviceUiSpec`) with Vite into a
 * single gzipped HTML file that the firmware embeds as `main/index.html.gz`.
 *
 * The Svelte sources are bundled into the server as raw strings and written to a scratch
 * directory per build, so this works the same from `vite dev` and from the compiled server.
 * Results are cached by content: unchanged UIs don't run Vite again.
 *
 * Icons: import them one by one as `@lucide/svelte/icons/<name>` (resolved from this server's
 * installation, like `svelte`). Styles: Tailwind utilities (theme in `device-ui/theme.css`), only
 * those the sources of this UI use; variants with `tailwind-variants/lite` (no class merging).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { Plugin, Rolldown } from 'vite';
import type { DeviceUiSpec } from '#lib/device/types.ts';
import faviconSvg from '../../assets/favicon.svg?raw';

const FIRMWARE_ROOT = '/src/lib/device/';

/** Everything a device UI may import, keyed by path relative to `src/lib/device/`. */
const SOURCES: Record<string, string> = Object.fromEntries(
	Object.entries(
		import.meta.glob(
			['/src/lib/device/device-ui/**/*', '/src/lib/device/features/*/device-ui/**/*'],
			{
				query: '?raw',
				import: 'default',
				eager: true
			}
		) as Record<string, string>
	).map(([file, source]) => [file.slice(FIRMWARE_ROOT.length), source])
);

/** Changes whenever any device UI source does (part of the firmware build key). */
export const DEVICE_UI_SOURCES_HASH = createHash('sha256')
	.update(JSON.stringify(SOURCES))
	.digest('hex')
	.slice(0, 16);

/** Cached builds kept on disk. */
const MAX_CACHED = 20;

export async function buildDeviceUi(
	spec: DeviceUiSpec,
	cacheDir: string,
	log: (line: string) => void
): Promise<Buffer> {
	for (const file of [spec.layout, ...spec.panels.map((p) => p.module)]) {
		if (!(file in SOURCES)) throw new Error(`Device UI file not found: src/lib/device/${file}`);
	}
	const { build, version: viteVersion } = await import('vite');
	const require = createRequire(import.meta.url);
	// `…/@lucide/svelte/dist/lucide-svelte.js` → package root (its path includes the version).
	const lucideDir = path.dirname(
		path.dirname(await fs.realpath(require.resolve('@lucide/svelte')))
	);
	const tailwindDir = path.dirname(await fs.realpath(require.resolve('tailwindcss/package.json')));
	const tvLite = fileURLToPath(import.meta.resolve('tailwind-variants/lite'));
	const key = createHash('sha256')
		.update(
			JSON.stringify({
				html: indexHtml(spec),
				spec,
				sources: DEVICE_UI_SOURCES_HASH,
				css: mainCss(spec, tailwindDir),
				viteVersion,
				lucideDir,
				tvLite
			})
		)
		.digest('hex')
		.slice(0, 16);
	const cached = path.join(cacheDir, `${key}.html.gz`);
	if (existsSync(cached)) {
		log(`Device web interface: ${spec.page} page unchanged (${key})`);
		const now = new Date();
		await fs.utimes(cached, now, now); // keeps it from being pruned
		return fs.readFile(cached);
	}

	log(`Building device web interface: ${spec.page} page (${spec.panels.length} panels)…`);
	const started = Date.now();
	await fs.mkdir(cacheDir, { recursive: true });
	const work = await fs.mkdtemp(path.join(cacheDir, 'build-'));
	try {
		const dirs = new Set(Object.keys(SOURCES).map((file) => path.dirname(path.join(work, file))));
		await Promise.all([...dirs].map((dir) => fs.mkdir(dir, { recursive: true })));
		await Promise.all(
			Object.entries(SOURCES).map(([file, source]) => fs.writeFile(path.join(work, file), source))
		);
		await fs.writeFile(path.join(work, 'main.ts'), entry(spec));
		await fs.writeFile(path.join(work, 'main.css'), mainCss(spec, tailwindDir));
		await fs.writeFile(path.join(work, 'index.html'), indexHtml(spec));
		// Resolve `svelte` (and its dependencies) from this server's installation.
		const svelteDir = path.dirname(require.resolve('svelte/package.json'));
		await fs.symlink(path.dirname(await fs.realpath(svelteDir)), path.join(work, 'node_modules'));

		const { svelte } = await import('@sveltejs/vite-plugin-svelte');
		const { default: tailwindcss } = await import('@tailwindcss/vite');
		await build({
			root: work,
			configFile: false,
			logLevel: 'warn',
			resolve: {
				alias: [
					{
						find: /^@lucide\/svelte\/icons\/([a-z0-9-]+)$/,
						replacement: `${lucideDir}/dist/icons/$1.js`
					},
					{ find: /^tailwind-variants\/lite$/, replacement: tvLite }
				]
			},
			plugins: [
				tailwindcss(),
				svelte({ configFile: false, compilerOptions: { runes: true } }),
				inlineAssets()
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

		const html = await fs.readFile(path.join(work, 'dist/index.html'));
		const gz = gzipSync(html, { level: 9 });
		await fs.writeFile(cached, gz);
		log(
			`Device web interface built in ${((Date.now() - started) / 1000).toFixed(1)} s ` +
				`(${(html.length / 1024).toFixed(1)} KB, ${(gz.length / 1024).toFixed(1)} KB gzipped)`
		);
		await prune(cacheDir, cached);
		return gz;
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}

/** The generated entry: the shell (login) with the page's layout and the selected panels. */
function entry(spec: DeviceUiSpec): string {
	const modules = [...new Set(spec.panels.map((p) => p.module))];
	const name = (module: string) => `Panel${modules.indexOf(module)}`;
	const panels = spec.panels.map(
		({ module, props, ...panel }) =>
			`\t\t\t{ ...${JSON.stringify(panel)}, props: ${JSON.stringify(props ?? {})}, component: ${name(module)} }`
	);
	// Tab icons of the page menu: Lucide icons by name.
	const icons = [...new Set(spec.pages.flatMap((p) => (p.icon ? [p.icon] : [])))];
	for (const icon of icons)
		if (!/^[a-z0-9-]+$/.test(icon)) throw new Error(`Bad icon name ${icon}`);
	const iconName = (icon: string) => `Icon${icons.indexOf(icon)}`;
	const pages = spec.pages.map(
		({ icon, ...page }) =>
			`\t\t\t\t{ ...${JSON.stringify(page)}${icon ? `, icon: ${iconName(icon)}` : ''} }`
	);
	return `// Generated by vibes-espmatter – device web interface entry.
import { mount } from 'svelte';
import './main.css';
import Shell from './features/web-ui/device-ui/Shell.svelte';
import Layout from './${spec.layout}';
${modules.map((m) => `import ${name(m)} from './${m}';`).join('\n')}
${icons.map((i) => `import ${iconName(i)} from '@lucide/svelte/icons/${i}';`).join('\n')}

mount(Shell, {
	target: document.getElementById('app')!,
	props: {
		layout: Layout,
		page: ${JSON.stringify(spec.page)},
		device: {
			...${JSON.stringify(spec.device)},
			pages: [
${pages.join(',\n')}
			]
		},
		panels: [
${panels.join(',\n')}
		]
	}
});
`;
}

/**
 * The generated stylesheet: Tailwind (without preflight, like the website's src/app.css) with the
 * theme, generating the utilities used by the shell, the shared components and this UI's features.
 */
function mainCss(spec: DeviceUiSpec, tailwindDir: string): string {
	const dirs = new Set([
		'device-ui',
		'features/web-ui/device-ui',
		...[spec.layout, ...spec.panels.map((p) => p.module)].map((file) => path.posix.dirname(file))
	]);
	return `@layer theme, base, components, utilities;
@import '${tailwindDir}/theme.css' layer(theme);
@import '${tailwindDir}/utilities.css' layer(utilities) source(none);
@import './device-ui/theme.css';
${[...dirs].map((dir) => `@source './${dir}';`).join('\n')}
`;
}

/** The website's favicon, inline: the device serves no separate file for it. */
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(faviconSvg.trim());

function indexHtml(spec: DeviceUiSpec): string {
	const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
	const title = escape(spec.device.name);
	// Home screen app (manifests and icon: the web interface).
	const manifest = `${spec.path === '/' ? '' : spec.path}/manifest.webmanifest`;
	const appTitle = escape(spec.appName);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title}</title>
		<link rel="icon" href="${FAVICON}" />
		<link rel="manifest" href="${manifest}" />
		<link rel="apple-touch-icon" href="/icon.png" />
		<meta name="mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-title" content="${appTitle}" />
		<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f7f9" />
		<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f141b" />
		<script type="module" src="/main.ts"></script>
	</head>
	<body>
		<div id="app"></div>
	</body>
</html>
`;
}

/** Inline the JS chunk and CSS into index.html: the ESP serves exactly one file. */
function inlineAssets(): Plugin {
	const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return {
		name: 'mesp-inline-assets',
		enforce: 'post',
		generateBundle(_options, bundle: Rolldown.OutputBundle) {
			const page = bundle['index.html'] as Rolldown.OutputAsset;
			let html = String(page.source);
			for (const [file, output] of Object.entries(bundle)) {
				if (output.type === 'chunk') {
					const code = output.code.replaceAll('</script', '<\\/script');
					html = html.replace(
						new RegExp(`<script[^>]*src="[^"]*${escape(file)}"[^>]*></script>`),
						() => `<script type="module">${code}</script>`
					);
					delete bundle[file];
				} else if (file.endsWith('.css')) {
					html = html.replace(
						new RegExp(`<link[^>]*href="[^"]*${escape(file)}"[^>]*>`),
						() => `<style>${String(output.source)}</style>`
					);
					delete bundle[file];
				}
			}
			page.source = html;
		}
	};
}

async function prune(dir: string, keep: string) {
	const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.html.gz'));
	const stats = await Promise.all(
		files.map(async (f) => ({
			file: path.join(dir, f),
			mtime: (await fs.stat(path.join(dir, f))).mtimeMs
		}))
	);
	stats.sort((a, b) => b.mtime - a.mtime);
	for (const { file } of stats.slice(MAX_CACHED)) if (file !== keep) await fs.rm(file);
}
