import { ctrl, defineBoard, gnd, gpio, named, nc, power } from '#sdk';

export default defineBoard({
	id: 'esp32-c6-devkitc-1',
	name: 'ESP32-C6-DevKitC-1',
	vendor: 'Espressif',
	chip: 'esp32c6',
	description: 'Official C6 dev board: Wi-Fi 6, BLE and Thread/Zigbee radio, two USB-C ports.',
	url: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32c6/esp32-c6-devkitc-1/',
	flashMB: 8,
	psram: 'none',
	usb: 'both',
	led: { gpio: 8, type: 'ws2812' },
	button: { gpio: 9 },
	buses: { i2c: { sda: 6, scl: 7 }, uart: { tx: 5, rx: 4 } },
	headers: {
		left: [
			power('3V3'),
			ctrl('RST'),
			gpio(4, ['strapping']),
			gpio(5, ['strapping']),
			gpio(6),
			gpio(7),
			gpio(0),
			gpio(1),
			gpio(8, ['RGB LED', 'strapping']),
			gpio(10),
			gpio(11),
			gpio(2),
			gpio(3),
			power('5V'),
			gnd(),
			nc()
		],
		right: [
			gnd(),
			named('TX', 16, ['U0TXD'], 'console'),
			named('RX', 17, ['U0RXD'], 'console'),
			gpio(15, ['strapping']),
			gpio(23),
			gpio(22),
			gpio(21),
			gpio(20),
			gpio(19),
			gpio(18),
			gpio(9, ['BOOT', 'strapping']),
			gnd(),
			gpio(13, ['USB D+']),
			gpio(12, ['USB D-']),
			gnd(),
			nc()
		]
	}
});
