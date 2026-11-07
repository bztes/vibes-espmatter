import { defineFeature } from '#sdk';

export default defineFeature({
	type: 'feature',
	id: 'ethernet',
	name: 'Ethernet',
	description:
		'Wired network through the board’s Ethernet PHY (e.g. WT32-ETH01). The most reliable uplink for a hub.',
	icon: 'cable',
	kinds: ['hub'],
	group: 'transport',
	requires: { capabilities: ['ethernet-mac'] },
	provides: ['ip', 'uplink', 'ethernet'],
	validate({ board }) {
		return board().ethernet
			? []
			: [
					{
						severity: 'error',
						message: `The ${board().name} has no Ethernet PHY – pick a board like the WT32-ETH01.`
					}
				];
	},
	contribute({ board }, out) {
		const eth = board().ethernet;
		if (!eth) return;
		out
			.firmware()
			.source('espm_eth.cpp', 'espm_eth.h')
			.include('"espm_eth.h"')
			.define({
				ESPM_ETH_PHY_LAN8720: eth.phy === 'LAN8720',
				ESPM_ETH_PHY_IP101: eth.phy === 'IP101',
				ESPM_ETH_PHY_RTL8201: eth.phy === 'RTL8201',
				ESPM_ETH_MDC: eth.mdc,
				ESPM_ETH_MDIO: eth.mdio,
				ESPM_ETH_POWER: eth.power ?? -1,
				ESPM_ETH_CLOCK_GPIO0_IN: eth.clock === 'GPIO0_IN'
			})
			.sdkconfig({
				CONFIG_ENABLE_WIFI_STATION: false,
				CONFIG_ETH_ENABLED: true,
				CONFIG_ETH_USE_ESP32_EMAC: true,
				CONFIG_CHIP_DEVICE_CONFIG_ENABLE_ETHERNET: true
			})
			.init('early', 'espm_eth_init();');
		out.api({
			method: 'GET',
			path: '/api/v1/ethernet',
			summary: 'Link state and address',
			auth: 'token',
			response: { link: true, speed: 100, duplex: 'full', ip: '192.168.1.50', mac: '…' }
		});
	}
});
