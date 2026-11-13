DROP TABLE `runner`;--> statement-breakpoint
CREATE TABLE `runner` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`idf_version` text,
	`concurrency` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_seen` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `runner_token_hash_unique` ON `runner` (`token_hash`);
