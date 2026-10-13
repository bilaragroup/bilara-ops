CREATE TABLE `project_configs` (
	`project` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`site` text NOT NULL,
	`manager_email` text NOT NULL,
	`engineer_emails` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_configs_manager` ON `project_configs` (`manager_email`);
