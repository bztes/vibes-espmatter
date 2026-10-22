/**
 * Time zones an admin can pick for the timers: IANA name → POSIX TZ rule (what newlib understands).
 * The device stores both (espm_timers.cpp).
 */
export const TIME_ZONES: Record<string, string> = {
	UTC: 'UTC0',
	'Europe/London': 'GMT0BST,M3.5.0/1,M10.5.0',
	'Europe/Dublin': 'IST-1GMT0,M10.5.0,M3.5.0/1',
	'Europe/Lisbon': 'WET0WEST,M3.5.0/1,M10.5.0',
	'Europe/Berlin': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Vienna': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Zurich': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Paris': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Amsterdam': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Madrid': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Rome': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Stockholm': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Warsaw': 'CET-1CEST,M3.5.0,M10.5.0/3',
	'Europe/Helsinki': 'EET-2EEST,M3.5.0/3,M10.5.0/4',
	'Europe/Athens': 'EET-2EEST,M3.5.0/3,M10.5.0/4',
	'Europe/Istanbul': '<+03>-3',
	'Europe/Moscow': 'MSK-3',
	'America/New_York': 'EST5EDT,M3.2.0,M11.1.0',
	'America/Chicago': 'CST6CDT,M3.2.0,M11.1.0',
	'America/Denver': 'MST7MDT,M3.2.0,M11.1.0',
	'America/Phoenix': 'MST7',
	'America/Los_Angeles': 'PST8PDT,M3.2.0,M11.1.0',
	'America/Sao_Paulo': '<-03>3',
	'Asia/Dubai': '<+04>-4',
	'Asia/Kolkata': 'IST-5:30',
	'Asia/Shanghai': 'CST-8',
	'Asia/Singapore': '<+08>-8',
	'Asia/Tokyo': 'JST-9',
	'Australia/Sydney': 'AEST-10AEDT,M10.1.0,M4.1.0/3',
	'Pacific/Auckland': 'NZST-12NZDT,M9.5.0,M4.1.0/3'
};
