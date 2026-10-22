import type { BoardDef } from '../types';
import { g, p, c } from '../pins';

export default {
	id: 'esp32-s3-devkitc-1',
	name: 'ESP32-S3-DevKitC-1',
	chip: 'esp32s3',
	description:
		'Official Espressif S3 dev board (N8R2 / N16R8 variants). Two USB ports: "UART" ("COM" on clones, USB bridge) and "USB" (native).',
	headers: {
		left: [
			p('3V3'),
			p('3V3'),
			c('RST'),
			g(4),
			g(5),
			g(6),
			g(7),
			g(15),
			g(16),
			g(17),
			g(18),
			g(8),
			g(3, ['strapping']),
			g(46, ['strapping'], 'strapping pin'),
			g(9),
			g(10),
			g(11),
			g(12),
			g(13),
			g(14),
			{
				...p('5V'),
				note: 'To use the 5V pin as an output (USB power to other boards), bridge the “IN-OUT” pads first – otherwise it stays dead. Clone boards ship with them open.'
			},
			p('GND')
		],
		right: [
			p('GND'),
			{
				label: 'TX',
				kind: 'gpio',
				gpio: 43,
				functions: ['U0TXD', 'console'],
				reserved: 'console'
			},
			{
				label: 'RX',
				kind: 'gpio',
				gpio: 44,
				functions: ['U0RXD', 'console'],
				reserved: 'console'
			},
			g(1),
			g(2),
			g(42),
			g(41),
			g(40),
			g(39),
			g(38, ['RGB LED (v1.1)']),
			g(37, [], 'octal PSRAM'),
			g(36, [], 'octal PSRAM'),
			g(35, [], 'octal PSRAM'),
			g(0, ['BOOT'], 'boot button'),
			g(45, ['strapping'], 'strapping pin'),
			g(48, ['RGB LED (v1.0)']),
			g(47),
			g(21),
			g(20, ['USB D+'], 'native USB'),
			g(19, ['USB D-'], 'native USB'),
			p('GND'),
			p('GND')
		]
	},
	flashSizeMB: 8,
	psram: 'quad',
	usb: 'both',
	ledGpio: 38,
	ledType: 'ws2812',
	bootButtonGpio: 0,
	url: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/'
} satisfies BoardDef;
