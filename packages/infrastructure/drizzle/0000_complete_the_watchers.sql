CREATE TABLE `llm_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`response` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`source_type` text NOT NULL,
	`content_hash` text,
	`page_count` integer,
	`char_count` integer,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status_created` ON `processing_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_jobs_material_stage` ON `processing_jobs` (`material_id`,`stage`);