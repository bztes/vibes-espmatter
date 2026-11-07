CREATE TABLE `build` (
	`id` text PRIMARY KEY NOT NULL,
	`firmware_id` text NOT NULL,
	`user_id` text,
	`version` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`config` text NOT NULL,
	`slots` text DEFAULT '{}' NOT NULL,
	`step` text,
	`error` text,
	`runner_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`firmware_id`) REFERENCES `firmware`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `build_firmware_idx` ON `build` (`firmware_id`);--> statement-breakpoint
CREATE TABLE `deployment` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`build_id` text NOT NULL,
	`slot` text NOT NULL,
	`version` integer NOT NULL,
	`method` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`build_id`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_device_idx` ON `deployment` (`device_id`,`slot`);--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`firmware_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`location_id` text,
	`settings` text NOT NULL,
	`api_token` text NOT NULL,
	`previous_token` text,
	`hub_id` text,
	`subdomain` text,
	`last_seen_at` integer,
	`reported` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`firmware_id`) REFERENCES `firmware`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hub_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `device_owner_idx` ON `device` (`owner_id`);--> statement-breakpoint
CREATE INDEX `device_firmware_idx` ON `device` (`firmware_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_subdomain_idx` ON `device` (`subdomain`);--> statement-breakpoint
CREATE TABLE `firmware` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`next_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `firmware_owner_idx` ON `firmware` (`owner_id`);--> statement-breakpoint
CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `location_owner_idx` ON `location` (`owner_id`);--> statement-breakpoint
CREATE TABLE `runner` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);