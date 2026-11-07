/**
 * Generic modules: every GPIO of the chip, for custom PCBs and boards that aren't listed (yet).
 * One file may export several boards as an array.
 */
import { genericBoard } from '#sdk';

export default [
	genericBoard('esp32', {
		id: 'generic-esp32-wroom-32',
		name: 'Generic ESP32-WROOM-32 module',
		buses: { i2c: { sda: 21, scl: 22 }, uart: { tx: 17, rx: 16 } }
	}),
	genericBoard('esp32s2', {
		id: 'generic-esp32-s2-mini',
		name: 'Generic ESP32-S2 module',
		usb: 'usb-serial-jtag'
	}),
	genericBoard('esp32s3', {
		id: 'generic-esp32-s3-wroom-1',
		name: 'Generic ESP32-S3-WROOM-1 module (N8)',
		flashMB: 8,
		buses: { i2c: { sda: 8, scl: 9 }, uart: { tx: 17, rx: 18 } }
	}),
	genericBoard('esp32c2', { id: 'generic-esp32-c2', name: 'Generic ESP32-C2 module (ESP8684)' }),
	genericBoard('esp32c3', {
		id: 'generic-esp32-c3-mini-1',
		name: 'Generic ESP32-C3-MINI-1 module'
	}),
	genericBoard('esp32c5', { id: 'generic-esp32-c5', name: 'Generic ESP32-C5 module', flashMB: 8 }),
	genericBoard('esp32c6', {
		id: 'generic-esp32-c6-wroom-1',
		name: 'Generic ESP32-C6-WROOM-1 module',
		flashMB: 8
	}),
	genericBoard('esp32c61', { id: 'generic-esp32-c61', name: 'Generic ESP32-C61 module' }),
	genericBoard('esp32h2', {
		id: 'generic-esp32-h2-mini-1',
		name: 'Generic ESP32-H2-MINI-1 module'
	}),
	genericBoard('esp32p4', {
		id: 'generic-esp32-p4',
		name: 'Generic ESP32-P4 module',
		flashMB: 16,
		psram: 'octal'
	})
];
