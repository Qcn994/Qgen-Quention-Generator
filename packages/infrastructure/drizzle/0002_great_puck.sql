CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`normalized_text` text NOT NULL,
	`normalization_version` text NOT NULL,
	`pages` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_documents_material_version` ON `documents` (`material_id`,`normalization_version`);