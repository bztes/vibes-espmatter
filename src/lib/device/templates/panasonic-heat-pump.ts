import type { TemplateDef } from '../types';

/**
 * A Panasonic air-to-air heat pump (e.g. the Nordic HZ25ZKE) as a Matter air conditioner: one
 * small ESP32 behind the unit's front cover, on the port of the Wi-Fi adapter.
 *
 * The chip id (`main`) is part of saved configurations and build artifacts – keep it.
 */
export default {
	id: 'panasonic-heat-pump',
	name: 'Panasonic heat pump',
	tagline: 'Matter for Panasonic ACs and heat pumps (HZ25ZKE …)',
	description:
		'Replaces the Panasonic Wi-Fi adapter: an ESP32 on the indoor unit’s CN-CNT or CN-WLAN port makes the heat pump a Matter air conditioner. Control power, mode, temperature, fan and swing from Apple Home, Google Home, Home Assistant or a Matter Thread Hub – locally, without the Panasonic cloud.',
	chips: [
		{
			id: 'main',
			name: 'Adapter',
			board: 'esp32-s3-supermini',
			features: {
				wifi: {},
				http_server: {},
				ota: {},
				app_updates: {},
				matter_device: {},
				panasonic_ac: {}
			}
		}
	]
} satisfies TemplateDef;
