/**
 * The ESP32 family. Boards name their chip; most checks (does it have Wi-Fi? may this GPIO drive
 * an output?) are answered here, so a new board is just a pinout.
 *
 * Sources: Espressif datasheets / technical reference manuals (GPIO & IO MUX chapters).
 */
import type { ChipDef, ChipId } from './types';

const range = (from: number, to: number, skip: number[] = []) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((n) => !skip.includes(n));

const adc = (unit: number, pins: number[], firstChannel = 0) =>
	Object.fromEntries(pins.map((p, i) => [p, `ADC${unit}_CH${firstChannel + i}`]));

/**
 * Download mode by software (ESP-IDF soc headers): RTC_CNTL_OPTION1_REG bit 0 on C3/S3,
 * LP_AON_SYS_CFG_REG bit 30 on the chips with an LP_AON block. UART0 pins from soc/uart_pins.h.
 */
const rtcCntlRom = (reg: number, tx: number, rx: number): ChipDef['rom'] => ({
	uart: { tx, rx },
	forceDownload: { reg, mask: 0x1 }
});
const lpAonRom = (tx: number, rx: number): ChipDef['rom'] => ({
	uart: { tx, rx },
	forceDownload: { reg: 0x600b1034, mask: 1 << 30 }
});

export const CHIPS: Record<ChipId, ChipDef> = {
	esp32: {
		id: 'esp32',
		name: 'ESP32',
		arch: 'xtensa',
		cores: 2,
		capabilities: ['wifi', 'ble', 'ethernet-mac'],
		gpios: range(0, 39, [20, 24, 28, 29, 30, 31]),
		inputOnly: [34, 35, 36, 37, 38, 39],
		strapping: [0, 2, 5, 12, 15],
		flashPins: [6, 7, 8, 9, 10, 11],
		adc: {
			...adc(1, [36, 37, 38, 39, 32, 33, 34, 35]),
			...{ 4: 'ADC2_CH0', 0: 'ADC2_CH1', 2: 'ADC2_CH2', 15: 'ADC2_CH3', 13: 'ADC2_CH4' },
			...{ 12: 'ADC2_CH5', 14: 'ADC2_CH6', 27: 'ADC2_CH7', 25: 'ADC2_CH8', 26: 'ADC2_CH9' }
		},
		adc2BlockedByWifi: true
	},
	esp32s2: {
		id: 'esp32s2',
		name: 'ESP32-S2',
		arch: 'xtensa',
		cores: 1,
		capabilities: ['wifi', 'usb-otg'],
		gpios: range(0, 46, [22, 23, 24, 25]),
		inputOnly: [46],
		strapping: [0, 45, 46],
		flashPins: [26, 27, 28, 29, 30, 31, 32],
		usbPins: [19, 20],
		adc: { ...adc(1, range(1, 10)), ...adc(2, range(11, 20)) },
		matterUnsupported: 'The ESP32-S2 has no Bluetooth, esp-matter does not support it.'
	},
	esp32s3: {
		id: 'esp32s3',
		name: 'ESP32-S3',
		arch: 'xtensa',
		cores: 2,
		capabilities: ['wifi', 'ble', 'usb-otg', 'usb-serial-jtag'],
		gpios: range(0, 48, [22, 23, 24, 25]),
		strapping: [0, 3, 45, 46],
		flashPins: [26, 27, 28, 29, 30, 31, 32],
		octalPsramPins: [33, 34, 35, 36, 37],
		usbPins: [19, 20],
		adc: { ...adc(1, range(1, 10)), ...adc(2, range(11, 20)) },
		rom: rtcCntlRom(0x6000812c, 43, 44)
	},
	esp32c2: {
		id: 'esp32c2',
		name: 'ESP32-C2',
		arch: 'riscv',
		cores: 1,
		capabilities: ['wifi', 'ble'],
		gpios: range(0, 20),
		strapping: [8, 9],
		flashPins: [11, 12, 13, 14, 15, 16, 17],
		adc: adc(1, range(0, 4)),
		note: 'Only 272 KB RAM: Matter works, but with very few features.'
	},
	esp32c3: {
		id: 'esp32c3',
		name: 'ESP32-C3',
		arch: 'riscv',
		cores: 1,
		capabilities: ['wifi', 'ble', 'usb-serial-jtag'],
		gpios: range(0, 21),
		strapping: [2, 8, 9],
		flashPins: [11, 12, 13, 14, 15, 16, 17],
		usbPins: [18, 19],
		adc: { ...adc(1, range(0, 4)), 5: 'ADC2_CH0' },
		rom: rtcCntlRom(0x600080f4, 21, 20)
	},
	esp32c5: {
		id: 'esp32c5',
		name: 'ESP32-C5',
		arch: 'riscv',
		cores: 1,
		capabilities: ['wifi', 'wifi-5ghz', 'ble', 'ieee802154', 'usb-serial-jtag'],
		gpios: range(0, 28),
		strapping: [2, 7, 25, 27, 28],
		flashPins: [16, 17, 18, 19, 20, 21, 22],
		usbPins: [13, 14],
		adc: adc(1, range(1, 6)),
		rom: lpAonRom(11, 12)
	},
	esp32c6: {
		id: 'esp32c6',
		name: 'ESP32-C6',
		arch: 'riscv',
		cores: 1,
		capabilities: ['wifi', 'ble', 'ieee802154', 'usb-serial-jtag'],
		gpios: range(0, 30),
		strapping: [4, 5, 8, 9, 15],
		flashPins: [24, 25, 26, 28, 29, 30],
		usbPins: [12, 13],
		adc: adc(1, range(0, 6)),
		rom: lpAonRom(16, 17)
	},
	esp32c61: {
		id: 'esp32c61',
		name: 'ESP32-C61',
		arch: 'riscv',
		cores: 1,
		capabilities: ['wifi', 'ble', 'usb-serial-jtag'],
		gpios: range(0, 29),
		strapping: [7, 8, 9],
		flashPins: [15, 16, 17, 18, 19, 20, 21],
		usbPins: [12, 13],
		adc: adc(1, range(1, 6)),
		rom: lpAonRom(11, 10)
	},
	esp32h2: {
		id: 'esp32h2',
		name: 'ESP32-H2',
		arch: 'riscv',
		cores: 1,
		capabilities: ['ble', 'ieee802154', 'usb-serial-jtag'],
		gpios: range(0, 27, [6, 7, 15, 16, 17, 18, 19, 20, 21]),
		strapping: [2, 3, 8, 9, 25],
		flashPins: [15, 16, 17, 18, 19, 20, 21],
		usbPins: [26, 27],
		adc: adc(1, range(1, 5)),
		rom: lpAonRom(24, 23)
	},
	esp32p4: {
		id: 'esp32p4',
		name: 'ESP32-P4',
		arch: 'riscv',
		cores: 2,
		capabilities: ['ethernet-mac', 'usb-otg', 'usb-serial-jtag', 'psram'],
		gpios: range(0, 54),
		strapping: [34, 35, 36, 37, 38],
		flashPins: [],
		usbPins: [24, 25, 26, 27],
		adc: { ...adc(1, range(16, 23)), ...adc(2, range(49, 54)) },
		note: 'No radio: Wi-Fi/BLE only through a companion chip (esp-hosted), Ethernet built in.'
	}
};

export const chipIds = Object.keys(CHIPS) as ChipId[];

export function chip(id: ChipId): ChipDef {
	return CHIPS[id];
}
