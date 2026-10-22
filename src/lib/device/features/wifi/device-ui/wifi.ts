/** `GET /api/wifi/status` (espm_wifi.cpp). */
export interface WifiStatus {
	connected: boolean;
	ssid?: string;
	rssi?: number;
	channel?: number;
	ip?: string;
	ip6?: string[];
	mac?: string;
}
