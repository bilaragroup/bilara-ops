-- Project fields the site (QC) app keeps alongside the purchasing project configuration.
ALTER TABLE `project_configs` ADD COLUMN `status` text NOT NULL DEFAULT 'ONGOING';
--> statement-breakpoint
ALTER TABLE `project_configs` ADD COLUMN `state` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `project_configs` ADD COLUMN `milestone` text NOT NULL DEFAULT '';
