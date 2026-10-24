ALTER TABLE `alarm_settings` ADD `vibration_pattern` text DEFAULT 'RISE' NOT NULL;--> statement-breakpoint
ALTER TABLE `alarm_settings` ADD `smart_wake` integer DEFAULT false NOT NULL;