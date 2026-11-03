CREATE TABLE `device_update` (
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`build_id` text NOT NULL,
	`version` integer NOT NULL,
	`state` text DEFAULT 'requested' NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `role`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`build_id`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
