CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`data` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_record` ON `history` (`record_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`parent` text,
	`source_id` text,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `records_source_id_unique` ON `records` (`source_id`);--> statement-breakpoint
CREATE INDEX `records_kind` ON `records` (`kind`);--> statement-breakpoint
CREATE INDEX `records_parent` ON `records` (`parent`);