CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`user_id` text,
	`response` text NOT NULL,
	`correct` integer NOT NULL,
	`score` real NOT NULL,
	`missing` text DEFAULT '[]' NOT NULL,
	`wrong` text DEFAULT '[]' NOT NULL,
	`graded_by` text DEFAULT 'rule' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attempts_question_created` ON `attempts` (`question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`page_start` integer,
	`page_end` integer,
	`heading_path` text DEFAULT '[]' NOT NULL,
	`content_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chunks_material_ordinal` ON `chunks` (`material_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_chunks_content_hash` ON `chunks` (`content_hash`);--> statement-breakpoint
CREATE TABLE `knowledge_points` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`canonical_name` text NOT NULL,
	`summary` text NOT NULL,
	`importance` integer NOT NULL,
	`difficulty` integer DEFAULT 3 NOT NULL,
	`exam_frequency` text DEFAULT 'medium' NOT NULL,
	`chunk_ids` text DEFAULT '[]' NOT NULL,
	`evidence_quotes` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `knowledge_points`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_kp_material` ON `knowledge_points` (`material_id`,`importance`);--> statement-breakpoint
CREATE TABLE `misconceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`kp_id` text NOT NULL,
	`statement` text NOT NULL,
	`why_tempting` text NOT NULL,
	`correct_contrast` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kp_id`) REFERENCES `knowledge_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_misconception_kp` ON `misconceptions` (`kp_id`);--> statement-breakpoint
CREATE TABLE `question_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`passed` integer NOT NULL,
	`score` real,
	`model` text,
	`detail` text,
	`details` text,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_checks_question` ON `question_checks` (`question_id`,`severity`);--> statement-breakpoint
CREATE TABLE `question_source_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`quote` text NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`page_no` integer NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_source_refs_question` ON `question_source_refs` (`question_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`type` text NOT NULL,
	`stem` text NOT NULL,
	`options` text NOT NULL,
	`answer` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`difficulty_est` integer DEFAULT 3 NOT NULL,
	`difficulty_empirical` real,
	`primary_kp_id` text NOT NULL,
	`kp_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`stem_hash` text,
	`simhash` text,
	`duplicate_of` text,
	`generation_meta` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text,
	`parent_question_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`primary_kp_id`) REFERENCES `knowledge_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_questions_idempotency_key` ON `questions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_questions_material_status` ON `questions` (`material_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_questions_primary_kp` ON `questions` (`primary_kp_id`);--> statement-breakpoint
CREATE INDEX `idx_questions_stem_hash` ON `questions` (`stem_hash`);--> statement-breakpoint
CREATE INDEX `idx_questions_simhash` ON `questions` (`simhash`);--> statement-breakpoint
CREATE TABLE `review_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`question_id` text NOT NULL,
	`interval_index` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL,
	`consecutive_correct` integer DEFAULT 0 NOT NULL,
	`graduated` integer DEFAULT false NOT NULL,
	`stability` real,
	`difficulty` real,
	`lapses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_due` ON `review_cards` (`graduated`,`due_at`);