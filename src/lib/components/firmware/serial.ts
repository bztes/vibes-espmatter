/** Talking to a board over Web Serial with esptool-js: connect, find a partition, restart. */
import type { ESPLoader, Transport } from 'esptool-js';

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Board {
	loader: ESPLoader;
	transport: Transport;
	/** esptool's description of the chip. */
	description: string;
}

/** Ask for a port and connect to the board's ROM loader. Undefined: the dialog was closed. */
export async function connectBoard(log: (line: string) => void): Promise<Board | undefined> {
	let port: SerialPort;
	try {
		port = await navigator.serial.requestPort();
	} catch {
		return undefined;
	}
	const { ESPLoader, Transport } = await import('esptool-js');
	const transport = new Transport(port, false);
	try {
		const loader = new ESPLoader({
			transport,
			baudrate: 460800,
			terminal: { clean: () => {}, writeLine: log, write: log }
		});
		const description = await loader.main();
		return { loader, transport, description };
	} catch (e) {
		await transport.disconnect().catch(() => {});
		throw e;
	}
}

/** esptool-js' hard reset only releases EN; pull it first so the firmware starts. */
export async function resetBoard(transport: Transport) {
	await transport.setDTR(false);
	await transport.setRTS(true);
	await sleep(150);
	await transport.setRTS(false);
	await sleep(150);
}

const TABLE_OFFSET = 0x8000;
const TABLE_SIZE = 0xc00;

/** A partition in the board's own partition table (at 0x8000), by label. */
export async function findPartition(loader: ESPLoader, label: string) {
	const table = await loader.readFlash(TABLE_OFFSET, TABLE_SIZE);
	const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
	for (let at = 0; at + 32 <= table.length; at += 32) {
		// Entries start with 0xAA 0x50; the table ends with an MD5 entry or erased flash.
		if (table[at] !== 0xaa || table[at + 1] !== 0x50) break;
		const name = new TextDecoder().decode(table.subarray(at + 12, at + 28)).replace(/\0.*$/s, '');
		if (name === label)
			return { offset: view.getUint32(at + 4, true), size: view.getUint32(at + 8, true) };
	}
	return undefined;
}

export function toBase64(data: Uint8Array) {
	let text = '';
	for (const b of data) text += String.fromCharCode(b);
	return btoa(text);
}

export function fromBase64(text: string) {
	return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
