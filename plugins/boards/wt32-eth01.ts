import { ctrl, defineBoard, gnd, gpio, named, power } from '#sdk';

export default defineBoard({
	id: 'wt32-eth01',
	name: 'WT32-ETH01',
	vendor: 'Wireless-Tag',
	chip: 'esp32',
	description:
		'ESP32 with LAN8720 Ethernet PHY – a wired hub. No USB: flash it with a 3.3 V USB-UART adapter (IO0 to GND while resetting).',
	flashMB: 4,
	psram: 'none',
	usb: 'none',
	button: { gpio: 0 },
	buses: { i2c: { sda: 14, scl: 15 }, uart: { tx: 17, rx: 5 } },
	ethernet: { phy: 'LAN8720', mdc: 23, mdio: 18, power: 16, clock: 'GPIO0_IN' },
	headers: {
		left: [
			ctrl('EN'),
			gnd(),
			power('3V3'),
			gpio(1, ['TXD0'], 'console'),
			gpio(3, ['RXD0'], 'console'),
			gpio(14),
			gpio(12, ['strapping']),
			gpio(15, ['strapping']),
			gpio(35, ['input only']),
			named('IO36', 36, ['input only']),
			named('IO39', 39, ['input only']),
			gpio(2, ['strapping']),
			gpio(4)
		],
		right: [
			named('CFG', 32),
			named('485_EN', 33),
			named('RXD', 5, ['strapping']),
			named('TXD', 17),
			gnd(),
			power('3V3'),
			gnd(),
			power('5V'),
			named('IO0', 0, ['EMAC clock in'], 'Ethernet clock'),
			named('IO16', 16, [], 'Ethernet PHY power')
		]
	}
});
