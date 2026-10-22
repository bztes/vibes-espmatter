import type { BoardDef } from '../types';
import { g, p } from '../pins';

export default {
	id: 'waveshare-esp32-h2-zero',
	name: 'Waveshare ESP32-H2-Zero',
	chip: 'esp32h2',
	description:
		'Waveshare H2 board in the "Zero" form factor with native USB-C. TX/RX sit at the top right, next to the USB connector.',
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
			g(5)
		],
		right: [
			{ label: 'TX', kind: 'gpio', gpio: 24, functions: ['U0TXD'] },
			{ label: 'RX', kind: 'gpio', gpio: 23, functions: ['U0RXD'] },
			g(25, ['strapping']),
			g(22),
			g(14),
			g(13),
			g(12),
			g(11),
			g(10)
		]
	},
	flashSizeMB: 4,
	psram: 'none',
	usb: 'usb-serial-jtag',
	ledGpio: 8,
	ledType: 'ws2812',
	bootButtonGpio: 9,
	url: 'https://www.waveshare.com/wiki/ESP32-H2-Zero'
} satisfies BoardDef;
