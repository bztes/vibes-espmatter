import type { Component } from 'svelte';

/** Passed to every layout by the generated entry (see `src/lib/server/device-ui`). */
export interface DeviceInfo {
	name: string;
	typeName: string;
	roleName: string;
	/** The pages of the device, in menu order (`DevicePage`, with the tab icon as a component). */
	pages: PageLink[];
}

export interface PageLink {
	id: string;
	path: string;
	title: string;
	/** `admin`: admins only; `user`: every logged-in user. */
	access: 'admin' | 'user';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	icon?: Component<any>;
}

export interface PanelEntry {
	id: string;
	title: string;
	area: string;
	/** Sub-page of the setup page (Hub layout). */
	section: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	props: Record<string, unknown>;
}

export interface LayoutProps {
	device: DeviceInfo;
	/** Id of the page this layout shows. */
	page: string;
	panels: PanelEntry[];
}

/** `GET /api/status` (HTTP server feature, `espm_system.cpp`). */
export interface SystemStatus {
	name: string;
	deviceType: string;
	firmware: string;
	buildId: string;
	compiled: string;
	idf: string;
	chip: string;
	chipRevision: number;
	cores: number;
	uptime: number;
	resetReason: string;
	heapFree: number;
	heapMin: number;
	psramFree: number;
	partition?: string;
	flash: {
		/** Flash chip size in bytes. */
		size?: number;
		/** Size of the running app image and of its partition. */
		app?: number;
		appPartition?: number;
		/** NVS (settings, Matter fabric, Thread dataset) entries, 32 bytes each. */
		nvsUsed?: number;
		nvsTotal?: number;
	};
}
