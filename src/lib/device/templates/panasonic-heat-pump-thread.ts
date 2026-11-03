import type { TemplateDef } from '../types';

/**
 * The Panasonic heat pump on Thread instead of Wi-Fi: an ESP32-H2 with its own 802.15.4 radio.
 * No web interface or over-the-air updates – those need Wi-Fi.
 *
 * The chip id (`main`) is part of saved configurations and build artifacts – keep it.
 */
export default {
	id: 'panasonic-heat-pump-thread',
	name: 'Panasonic heat pump (Thread)',
	tagline: 'Matter over Thread for Panasonic ACs and heat pumps (HZ25ZKE …)',
	description:
		'Replaces the Panasonic Wi-Fi adapter: an ESP32-H2 on the indoor unit’s CN-CNT or CN-WLAN port makes the heat pump a Matter air conditioner on your Thread network. Needs a Thread border router (Apple TV, HomePod, Google Nest Hub or a Matter Thread Hub) – locally, without the Panasonic cloud.',
	chips: [
		{
			id: 'main',
			name: 'Adapter',
			board: 'esp32-h2-supermini',
			features: {
				thread: {},
				matter_device: {},
				panasonic_ac: {}
			}
		}
	]
} satisfies TemplateDef;
