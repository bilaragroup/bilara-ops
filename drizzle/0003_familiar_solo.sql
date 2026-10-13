CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`window` text NOT NULL,
	`vendor` text NOT NULL,
	`type` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_project_window` ON `documents` (`project`,`window`);