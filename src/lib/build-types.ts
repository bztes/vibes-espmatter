// Types shared between the build runner (server) and the build/flash UI (client).

export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface FlashPart {
	/** File name inside the build's artifact directory. */
	file: string;
	offset: number;
	size: number;
}

export interface RoleArtifacts {
	chip: string;
	flashMode: string;
	flashFreq: string;
	flashSize: string;
	/** PSRAM mode the firmware was built for; it aborts at boot if the chip has a different one. */
	psram?: 'none' | 'quad' | 'octal';
	parts: FlashPart[];
	/** Application image for OTA updates. */
	app: string;
	/** Single image to flash at 0x0, if it could be created. */
	merged?: string;
}

export interface RoleBuildState {
	status: BuildStatus;
	target: string;
	board: string;
	error?: string;
	durationMs?: number;
	artifacts?: RoleArtifacts;
}
