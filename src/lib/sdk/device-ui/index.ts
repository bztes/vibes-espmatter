/**
 * `#sdk/device-ui` – building blocks for widgets of the device web interface. Widgets are Svelte
 * components in a plugin's `ui/` folder; they get their `props` (from `contribute`) and talk to the
 * device with `api()` / `Poll`. Styling: these components, Tailwind with the tokens of `theme.css`.
 */
export { default as Button, button } from './Button.svelte';
export { default as Toggle } from './Toggle.svelte';
export { default as Stat } from './Stat.svelte';
export { default as Badge, badge } from './Badge.svelte';
export { default as Row } from './Row.svelte';
export { default as Slider } from './Slider.svelte';
export { default as Notice } from './Notice.svelte';
export { default as Segmented } from './Segmented.svelte';
export { default as Dialog } from './Dialog.svelte';
export { default as Popover } from './Popover.svelte';
export { default as PopupHost } from './PopupHost.svelte';
export { openPopup, type Popup } from './popup.svelte';
export { default as TitleMenu } from './TitleMenu.svelte';
export { default as MenuItem } from './MenuItem.svelte';
export { default as Input, input } from './Input.svelte';
export { default as Select, select, type SelectGroup, type SelectOption } from './Select.svelte';
export { default as Checkbox } from './Checkbox.svelte';
export { default as Radio } from './Radio.svelte';
export { default as Spinner } from './Spinner.svelte';
export { default as Code, code } from './Code.svelte';
export { default as CodeBlock, codeBlock } from './CodeBlock.svelte';
export { default as Spot } from './Spot.svelte';
export {
	registerSpotItems,
	type SpotName,
	type Spots,
	type DeviceContext,
	type DeviceRef,
	type SpotItem
} from './spots.svelte';
export { default as ValueLink } from './ValueLink.svelte';
export {
	registerValueTargets,
	type ValueRef,
	type ValueSeries,
	type ValueTarget,
	type ValueLinkTarget
} from './values.svelte';
export {
	api,
	ApiError,
	errorText,
	formatBytes,
	formatDuration,
	formatNumber,
	getToken,
	setToken,
	onUnauthorized
} from './api';
export { Poll } from './poll.svelte';
export { Stored } from './stored.svelte';
export { cardHeader, provideCardHeader } from './card-header.svelte';
export { session } from './session.svelte';
export { route } from './route.svelte';
export type { SpotStory, Story, ValueTargetStory } from './story';
