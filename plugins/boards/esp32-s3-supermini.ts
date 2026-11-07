import { defineBoard, gnd, gpio, named, power } from '#sdk';

export default defineBoard({
	id: 'esp32-s3-supermini',
	name: 'ESP32-S3 SuperMini',
	chip: 'esp32s3',
	description:
		'Tiny S3 board (4 MB flash, 2 MB PSRAM) with native USB-C. Pin order differs between clones – check the silkscreen.',
	flashMB: 4,
	psram: 'quad',
	usb: 'usb-serial-jtag',
	led: { gpio: 48, type: 'ws2812' },
	button: { gpio: 0 },
	buses: { i2c: { sda: 8, scl: 9 }, uart: { tx: 5, rx: 4 } },
	headers: {
		left: [
			named('TX', 43, ['U0TXD']),
			named('RX', 44, ['U0RXD']),
			gpio(1),
			gpio(2),
			gpio(3, ['strapping']),
			gpio(4),
			gpio(5),
			gpio(6),
			gpio(7),
			gpio(8)
		],
		right: [power('5V'), gnd(), power('3V3'), gpio(13), gpio(12), gpio(11), gpio(10), gpio(9)]
	}
});
