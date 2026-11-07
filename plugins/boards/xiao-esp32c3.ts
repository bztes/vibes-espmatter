import { defineBoard, gnd, named, power } from '#sdk';

export default defineBoard({
	id: 'xiao-esp32c3',
	name: 'Seeed XIAO ESP32C3',
	vendor: 'Seeed Studio',
	chip: 'esp32c3',
	description: 'Thumb-sized C3 with external antenna connector. No user LED.',
	url: 'https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/',
	flashMB: 4,
	psram: 'none',
	usb: 'usb-serial-jtag',
	button: { gpio: 9 },
	buses: { i2c: { sda: 6, scl: 7 }, uart: { tx: 21, rx: 20 } },
	headers: {
		left: [
			named('D0', 2, ['A0', 'strapping']),
			named('D1', 3, ['A1']),
			named('D2', 4, ['A2']),
			named('D3', 5, ['A3']),
			named('D4', 6, ['SDA']),
			named('D5', 7, ['SCL']),
			named('D6', 21, ['TX'])
		],
		right: [
			power('5V'),
			gnd(),
			power('3V3'),
			named('D10', 10, ['MOSI']),
			named('D9', 9, ['MISO', 'BOOT', 'strapping']),
			named('D8', 8, ['SCK', 'strapping']),
			named('D7', 20, ['RX'])
		]
	}
});
