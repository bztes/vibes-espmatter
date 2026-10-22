/**
 * What features register for the configurator, the web app (`services.ts`) – never part of the
 * device: settings editors (`configuratorEditors`, built from `components/config/`), configurator
 * tabs (`configuratorTabs`) and flash methods (`flashMethods`). Their components live in each
 * feature's `configurator/` folder.
 */
import type { Component } from 'svelte';
import type { RoleArtifacts } from '#lib/build-types.ts';
import type { Services } from './services';
import type { BoardDef, ChipConfig, FeatureConfig, ProjectConfig } from './types';

/**
 * Props of a configurator tab: a tab of the configurator next to Compose and Wire, shown for each
 * chip whose feature registered it (`configuratorTabs`) and updated live while editing (e.g. the HTTP
 * server's REST API docs).
 */
export interface ConfiguratorTabProps {
	/** The device as configured (normalized). */
	project: ProjectConfig;
	chip: ChipConfig;
	/** Its settings (defaults applied). */
	config: FeatureConfig;
	/** The chip's services, e.g. the HTTP server's `deviceApi`. */
	services: Services;
	/** Last known address of the device's web interface, e.g. `http://hub.local`. */
	address?: string | null;
}

/**
 * Props of a flash method: a way to install a finished build besides USB (which is always
 * there), shown for each chip whose firmware has the feature that registered it (e.g. OTA).
 */
export interface FlashProps {
	buildId: string;
	roleId: string;
	artifacts: RoleArtifacts;
	/** Last known address of the device's web interface, pre-filled. */
	address?: string | null;
	/** Called with the device URL once it was reached. */
	onaddress?: (url: string) => void;
}

/** A way to flash a build, registered with `flashMethods`. */
export interface FlashMethod {
	id: string;
	/** Its name in the flash dialog. */
	title: string;
	component: Component<FlashProps>;
}

/** A configurator tab, registered with `configuratorTabs`. */
export interface ConfiguratorTab {
	/** In the URL (`?view=api`). */
	id: string;
	title: string;
	component: Component<ConfiguratorTabProps>;
}

/** A feature's settings editor (`configuratorEditors`): each takes its own feature's settings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConfiguratorEditor = Component<ConfiguratorEditorProps<any>>;

/** Props of a feature's settings editor (`configuratorEditors`). */
export interface ConfiguratorEditorProps<T extends FeatureConfig = FeatureConfig> {
	/** Its settings (bindable). */
	config: T;
	board: BoardDef;
	chip: ChipConfig;
	/** Issues at a setting's key. */
	errors: Record<string, string>;
}
