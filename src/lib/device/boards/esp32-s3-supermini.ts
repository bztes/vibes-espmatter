import type { BoardDef } from '../types';
import { g, p } from '../pins';

export default {
	id: 'esp32-s3-supermini',
	name: 'ESP32-S3 SuperMini',
	chip: 'esp32s3',
	description:
		'Tiny S3 board (4 MB flash, 2 MB PSRAM) with native USB-C. Pin order may differ between clones – check the silkscreen.',
	headers: {
		left: [
			{ label: 'TX', kind: 'gpio', gpio: 43, functions: ['U0TXD'] },
			{ label: 'RX', kind: 'gpio', gpio: 44, functions: ['U0RXD'] },
			g(1),
			g(2),
			g(3, ['strapping']),
			g(4),
			g(5),
			g(6),
			g(7),
			g(8)
		],
		right: [p('5V'), p('GND'), p('3V3'), g(13), g(12), g(11), g(10), g(9)]
	},
	flashSizeMB: 4,
	psram: 'quad',
	usb: 'usb-serial-jtag',
	ledGpio: 48,
	ledType: 'ws2812',
	bootButtonGpio: 0
} satisfies BoardDef;
