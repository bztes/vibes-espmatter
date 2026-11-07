// Production entry: the SvelteKit app (adapter-node's handler) plus WebSocket upgrades for device
// tunnels, which SvelteKit itself doesn't take. The tunnel code is part of the app bundle and
// registers itself on globalThis when the app starts (src/lib/server/tunnel/core.ts).
import { createServer } from 'node:http';
import { handler } from './build/handler.js';

const TUNNELS = Symbol.for('espmatter.tunnels');
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const server = createServer(handler);
server.on('upgrade', (req, socket, head) => {
	if (!globalThis[TUNNELS]?.upgrade?.(req, socket, head)) socket.destroy();
});
server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'])
	process.on(signal, () => {
		server.close(() => process.exit(0));
		server.closeAllConnections();
	});
