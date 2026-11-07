/** Types shared by server and browser. */

export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface FlashPart {
	file: string;
	offset: number;
	size: number;
}

/** What a build produced for one board slot. */
export interface SlotArtifacts {
	name: string;
	board: string;
	chip: string;
	flashFirst: boolean;
	/** The main board installs it over a wire (after a first USB flash). */
	viaMain?: boolean;
	flashMode: string;
	flashFreq: string;
	flashSize: string;
	parts: FlashPart[];
	/** Application image (OTA). */
	app: string;
	appSize: number;
	/** Everything of the build in one image, flashed at 0x0 (without a device configuration). */
	merged: string;
	sha256: string;
	/** Where a device's configuration partition goes (slots that have one). */
	config?: { offset: number; size: number };
}

/** `push` only in deployments from before updates were pull-only. */
export type DeployMethod = 'usb' | 'pull' | 'hub' | 'push';
export type DeployState =
	'pending' | 'downloading' | 'installing' | 'done' | 'failed' | 'superseded';
