/** Classes shared by the automation dialog's parts. */
export const panel = 'flex flex-wrap items-center justify-center gap-x-4 gap-y-3';
export const side = 'grid min-w-48 flex-1 content-center gap-2';
export const choice = (on: boolean) =>
	[
		'h-8 min-w-0 truncate rounded-md px-2 text-xs font-medium ring-1 transition-colors ring-inset',
		on
			? 'bg-accent-soft text-accent ring-accent'
			: 'bg-surface text-muted ring-border-strong hover:text-fg'
	].join(' ');
export const withUnit = (unit?: string) => (v: number) =>
	[String(v), unit ?? ''] as [string, string];
