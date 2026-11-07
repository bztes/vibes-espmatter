import { defineBoard, gnd, gpio, named, power } from '#sdk';

export default defineBoard({
	id: 'waveshare-esp32-h2-zero',
	name: 'Waveshare ESP32-H2-Zero',
	vendor: 'Waveshare',
	chip: 'esp32h2',
	description: 'H2 board in the "Zero" form factor with native USB-C.',
	url: 'https://www.waveshare.com/wiki/ESP32-H2-Zero',
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
			gpio(5)
		],
		right: [
			named('TX', 24, ['U0TXD']),
			named('RX', 23, ['U0RXD']),
			gpio(25, ['strapping']),
			gpio(22),
			gpio(14),
			gpio(13),
			gpio(12),
			gpio(11),
			gpio(10)
		]
	}
});
