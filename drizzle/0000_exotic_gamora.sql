CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`score` integer NOT NULL,
	`taken_at` text NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `learners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`store_id` text NOT NULL,
	`country` text NOT NULL,
	`entered_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`best_score` integer,
	`certificate_token` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learners_email_unique` ON `learners` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `learners_certificate_token_unique` ON `learners` (`certificate_token`);--> statement-breakpoint
CREATE TABLE `legacy_completions` (
	`email` text PRIMARY KEY NOT NULL,
	`completed` integer NOT NULL,
	`completed_at` text,
	`store_id` text,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `module_views` (
	`learner_id` text NOT NULL,
	`module_key` text NOT NULL,
	`viewed_at` text NOT NULL,
	PRIMARY KEY(`learner_id`, `module_key`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action
);
