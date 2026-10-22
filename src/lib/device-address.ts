/** Address of a device's web interface, as the device reports it and as it is saved. */
export const DEVICE_ADDRESS = /^http:\/\/[a-z0-9.-]+(:\d{1,5})?\/?$/i;

/** A typed-in device address as a URL: trimmed, without trailing slashes, `http://` unless a scheme is given. */
export function toDeviceUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, '');
	return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
