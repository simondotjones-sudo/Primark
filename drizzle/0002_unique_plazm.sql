CREATE TABLE `course_files` (
	`package_id` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`package_id`, `path`),
	FOREIGN KEY (`package_id`) REFERENCES `course_packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `course_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`filename` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`scos_json` text DEFAULT '[]' NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`audience_json` text NOT NULL,
	`package_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scorm_launches` (
	`token` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`package_id` text NOT NULL,
	`learner_id` text,
	`sco_id` text NOT NULL,
	`preview` integer DEFAULT 0 NOT NULL,
	`seed_json` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`base_time` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`package_id`) REFERENCES `course_packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scorm_progress` (
	`learner_id` text NOT NULL,
	`package_id` text NOT NULL,
	`sco_id` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`score` text,
	`total_centiseconds` integer DEFAULT 0 NOT NULL,
	`active_launch` text,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`learner_id`, `package_id`, `sco_id`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`package_id`) REFERENCES `course_packages`(`id`) ON UPDATE no action ON DELETE no action
);
