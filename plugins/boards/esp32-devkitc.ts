import { ctrl, defineBoard, gnd, gpio, named, power } from '#sdk';

export default defineBoard({
	id: 'esp32-devkitc',
	name: 'ESP32-DevKitC V4',
	vendor: 'Espressif',
	chip: 'esp32',
	description: 'Classic ESP32-WROOM-32 dev board with CP2102/CH340 USB bridge (38 pins).',
	url: 'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/',
	flashMB: 4,
	psram: 'none',
	usb: 'uart-bridge',
	button: { gpio: 0 },
	buses: { i2c: { sda: 21, scl: 22 }, uart: { tx: 17, rx: 16 } },
	headers: {
		left: [
			power('3V3'),
			ctrl('EN'),
			named('VP', 36, ['ADC1_CH0', 'input only']),
			named('VN', 39, ['ADC1_CH3', 'input only']),
			gpio(34, ['ADC1_CH6', 'input only']),
			gpio(35, ['ADC1_CH7', 'input only']),
			gpio(32, ['ADC1_CH4']),
			gpio(33, ['ADC1_CH5']),
			gpio(25, ['DAC1']),
			gpio(26, ['DAC2']),
			gpio(27),
			gpio(14),
			gpio(12, ['strapping (flash voltage)']),
			gnd(),
			gpio(13),
			named('D2', 9, [], 'flash'),
			named('D3', 10, [], 'flash'),
			named('CMD', 11, [], 'flash'),
			power('5V')
		],
		right: [
			gnd(),
			gpio(23, ['VSPI MOSI']),
			gpio(22, ['I2C SCL']),
			named('TX', 1, ['U0TXD'], 'console'),
			named('RX', 3, ['U0RXD'], 'console'),
			gpio(21, ['I2C SDA']),
			gnd(),
			gpio(19),
			gpio(18),
			gpio(5, ['strapping']),
			gpio(17, ['U2TXD']),
			gpio(16, ['U2RXD']),
			gpio(4),
			gpio(0, ['BOOT', 'strapping']),
			gpio(2, ['strapping']),
			gpio(15, ['strapping']),
			named('D1', 8, [], 'flash'),
			named('D0', 7, [], 'flash'),
			named('CLK', 6, [], 'flash')
		]
	}
});
