const units: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 31536000],
	['month', 2592000],
	['day', 86400],
	['hour', 3600],
	['minute', 60],
	['second', 1]
];

/** "3 minutes ago". */
export function relativeTime(date: Date | number | null | undefined): string {
	if (!date) return 'never';
	const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
	const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	for (const [unit, s] of units)
		if (Math.abs(seconds) >= s || unit === 'second')
			return fmt.format(Math.round(seconds / s), unit);
	return '';
}
