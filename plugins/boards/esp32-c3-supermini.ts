import { defineBoard, gnd, gpio, named, power } from '#sdk';

export default defineBoard({
	id: 'esp32-c3-supermini',
	name: 'ESP32-C3 SuperMini',
	chip: 'esp32c3',
	description: 'Tiny, cheap C3 board with native USB-C. The blue LED on GPIO8 is active low.',
	flashMB: 4,
	psram: 'none',
	usb: 'usb-serial-jtag',
	led: { gpio: 8, type: 'gpio', activeLow: true },
	button: { gpio: 9 },
	buses: { i2c: { sda: 6, scl: 7 }, uart: { tx: 21, rx: 20 } },
	headers: {
		left: [
			power('5V'),
			gnd(),
			power('3V3'),
			gpio(4),
			gpio(3),
			gpio(2, ['strapping']),
			gpio(1),
			gpio(0)
		],
		right: [
			gpio(5),
			gpio(6),
			gpio(7),
			gpio(8, ['LED', 'strapping']),
			gpio(9, ['BOOT', 'strapping']),
			gpio(10),
			named('RX', 20, ['U0RXD']),
			named('TX', 21, ['U0TXD'])
		]
	}
});
