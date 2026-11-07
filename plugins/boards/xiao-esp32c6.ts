import { defineBoard, gnd, named, power } from '#sdk';

export default defineBoard({
	id: 'xiao-esp32c6',
	name: 'Seeed XIAO ESP32C6',
	vendor: 'Seeed Studio',
	chip: 'esp32c6',
	description: 'Thumb-sized C6 with Wi-Fi 6, BLE and Thread. User LED on GPIO15 (active low).',
	url: 'https://wiki.seeedstudio.com/xiao_esp32c6_getting_started/',
	flashMB: 4,
	psram: 'none',
	usb: 'usb-serial-jtag',
	led: { gpio: 15, type: 'gpio', activeLow: true },
	button: { gpio: 9 },
	buses: { i2c: { sda: 22, scl: 23 }, uart: { tx: 16, rx: 17 } },
	headers: {
		left: [
			named('D0', 0, ['A0']),
			named('D1', 1, ['A1']),
			named('D2', 2, ['A2']),
			named('D3', 21),
			named('D4', 22, ['SDA']),
			named('D5', 23, ['SCL']),
			named('D6', 16, ['TX'])
		],
		right: [
			power('5V'),
			gnd(),
			power('3V3'),
			named('D10', 18, ['MOSI']),
			named('D9', 20, ['MISO']),
			named('D8', 19, ['SCK']),
			named('D7', 17, ['RX'])
		]
	}
});
