import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';

/**
 * WebSocket upgrades of device tunnels in `vite dev` / `vite preview` (production: server.js). The
 * tunnel code registers itself on globalThis once the app's server code has loaded.
 */
const TUNNEL = /^\/api\/v1\/devices\/[0-9a-f-]{36}\/tunnel\/?(\?|$)/;
function deviceTunnels(): Plugin {
	const listen = (server: import('node:http').Server | null | undefined) =>
		server?.on('upgrade', (req, socket, head) => {
			if (!TUNNEL.test(req.url ?? '')) return; // e.g. Vite's HMR
			const tunnels = (
				globalThis as Record<symbol, { upgrade?: (...args: unknown[]) => boolean } | undefined>
			)[Symbol.for('espmatter.tunnels')];
			if (!tunnels?.upgrade?.(req, socket, head))
				socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n');
		});
	return {
		name: 'espmatter-device-tunnels',
		configureServer: (server) => void listen(server.httpServer as import('node:http').Server),
		configurePreviewServer: (server) => void listen(server.httpServer as import('node:http').Server)
	};
}

export default defineConfig({
	plugins: [
		deviceTunnels(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: { remoteFunctions: true }
		})
	],
	// Plugins (boards, features, peripherals) live next to `src/`, they may come from other repos.
	// Devices connect to the app (tunnel, updates, telemetry): listen on the LAN, not only localhost.
	server: { host: true, fs: { allow: ['plugins'] } },
	preview: { host: true },
	optimizeDeps: { include: ['esptool-js'] },
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}', 'plugins/**/*.{test,spec}.{js,ts}']
	}
});
