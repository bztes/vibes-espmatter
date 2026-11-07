import { defineBoard, gnd, gpio, named, power } from '#sdk';

export default defineBoard({
	id: 'esp32-h2-supermini',
	name: 'ESP32-H2 SuperMini',
	chip: 'esp32h2',
	description:
		'Tiny H2 board: Thread/Zigbee and BLE, no Wi-Fi. Great as Thread radio of a hub or as a Thread device.',
	flashMB: 4,
	psram: 'none',
	usb: 'usb-serial-jtag',
	led: { gpio: 8, type: 'ws2812' },
	button: { gpio: 9 },
	buses: { i2c: { sda: 12, scl: 22 }, uart: { tx: 24, rx: 23 } },
	headers: {
		left: [
			power('5V'),
			gnd(),
			power('3V3'),
			gpio(0),
			gpio(1),
			gpio(2, ['strapping']),
			gpio(3, ['strapping']),
			gpio(4),
			gpio(5),
			gpio(8, ['RGB LED', 'strapping']),
			gpio(9, ['BOOT', 'strapping'])
		],
		right: [
			gpio(10),
			gpio(11),
			gpio(12),
			gpio(13, ['LED']),
			gpio(14),
			gpio(22),
			named('TX', 24, ['U0TXD']),
			named('RX', 23, ['U0RXD']),
			gpio(25, ['strapping']),
			gpio(26, ['USB D-']),
			gpio(27, ['USB D+'])
		]
	}
});
