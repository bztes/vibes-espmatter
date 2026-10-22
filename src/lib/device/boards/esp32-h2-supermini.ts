import type { BoardDef } from '../types';
import { g, p } from '../pins';

export default {
	id: 'esp32-h2-supermini',
	name: 'ESP32-H2 SuperMini',
	chip: 'esp32h2',
	description:
		'Tiny H2 board with 802.15.4 (Thread/Zigbee) + BLE radio and native USB-C. Pin order may differ between clones – check the silkscreen.',
	headers: {
		left: [
			p('5V'),
			p('GND'),
			p('3V3'),
			g(0),
			g(1),
			g(2, ['strapping']),
			g(3, ['strapping']),
			g(4),
			g(5),
			g(8, ['RGB LED', 'strapping']),
			g(9, ['BOOT'], 'boot button')
		],
		right: [
			g(10),
			g(11),
			g(12),
			g(13, ['LED']),
			g(14),
			g(22),
			{ label: 'TX', kind: 'gpio', gpio: 24, functions: ['U0TXD'] },
			{ label: 'RX', kind: 'gpio', gpio: 23, functions: ['U0RXD'] },
			g(25, ['strapping']),
			g(26, ['USB D-'], 'native USB'),
			g(27, ['USB D+'], 'native USB')
		]
	},
	flashSizeMB: 4,
	psram: 'none',
	usb: 'usb-serial-jtag',
	ledGpio: 8,
	ledType: 'ws2812',
	bootButtonGpio: 9,
	url: 'https://www.espboards.dev/esp32/esp32-h2-super-mini/'
} satisfies BoardDef;
