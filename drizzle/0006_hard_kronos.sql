CREATE TABLE `app_users` (
	`email` text PRIMARY KEY NOT NULL,
	`subject` text,
	`name` text NOT NULL,
	`roles` text NOT NULL,
	`projects` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_subject_unique` ON `app_users` (`subject`);--> statement-breakpoint
CREATE TABLE `reference_rates` (
	`record_id` text PRIMARY KEY NOT NULL,
	`rate` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated` text NOT NULL
);

--> statement-breakpoint
INSERT INTO app_users (email,name,roles,projects,active,version) VALUES ('georgezenjoee@gmail.com','George','["Super Admin"]','[]',1,1);
--> statement-breakpoint
INSERT INTO app_users (email,name,roles,projects,active,version) VALUES ('georgezenjoe@gmail.com','George Zen Joe','["Super Admin"]','[]',1,1);
