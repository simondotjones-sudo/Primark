CREATE TABLE `shot_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`module_number` integer NOT NULL,
	`slide_number` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`thumbnail_key` text,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_shot_photos_module_slide` ON `shot_photos` (`module_number`,`slide_number`);--> statement-breakpoint
CREATE TABLE `shot_states` (
	`module_number` integer NOT NULL,
	`slide_number` integer NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`module_number`, `slide_number`),
	FOREIGN KEY (`updated_by`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action
);
