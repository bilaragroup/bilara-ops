CREATE TABLE `forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`window` text NOT NULL,
	`project` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forecasts_window_project` ON `forecasts` (`window`,`project`);