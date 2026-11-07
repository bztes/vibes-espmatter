import { defineBoard, gnd, named, power } from '#sdk';

export default defineBoard({
	id: 'xiao-esp32s3',
	name: 'Seeed XIAO ESP32S3',
	vendor: 'Seeed Studio',
	chip: 'esp32s3',
	description:
		'Thumb-sized S3 with 8 MB flash and 8 MB octal PSRAM. User LED on GPIO21 (active low).',
	url: 'https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/',
	flashMB: 8,
	psram: 'octal',
	usb: 'usb-serial-jtag',
	led: { gpio: 21, type: 'gpio', activeLow: true },
	button: { gpio: 0 },
	buses: { i2c: { sda: 5, scl: 6 }, uart: { tx: 43, rx: 44 } },
	headers: {
		left: [
			named('D0', 1, ['A0']),
			named('D1', 2, ['A1']),
			named('D2', 3, ['A2', 'strapping']),
			named('D3', 4, ['A3']),
			named('D4', 5, ['SDA']),
			named('D5', 6, ['SCL']),
			named('D6', 43, ['TX'])
		],
		right: [
			power('5V'),
			gnd(),
			power('3V3'),
			named('D10', 9, ['MOSI']),
			named('D9', 8, ['MISO']),
			named('D8', 7, ['SCK']),
			named('D7', 44, ['RX'])
		]
	}
});
