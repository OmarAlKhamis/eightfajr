CREATE TABLE `alarm_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`city_name` text NOT NULL,
	`country_code` text NOT NULL,
	`admin1` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`timezone` text NOT NULL,
	`method` text NOT NULL,
	`offset_minutes` integer DEFAULT 0 NOT NULL,
	`vibration_enabled` integer DEFAULT true NOT NULL,
	`vibration_power` integer DEFAULT 50 NOT NULL,
	`thermal_enabled` integer DEFAULT true NOT NULL,
	`thermal_level` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `eight_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`eight_user_id` text NOT NULL,
	`eight_timezone` text,
	`access_token_enc` text NOT NULL,
	`token_expires_at` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`attention_email_sent_at` text,
	`last_error_code` text,
	`connected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`rating` text NOT NULL,
	`comment` text,
	`page` text NOT NULL,
	`locale` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `magic_links` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_token_hash_unique` ON `magic_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `magic_links_email_idx` ON `magic_links` (`email`);--> statement-breakpoint
CREATE TABLE `managed_alarms` (
	`user_id` text PRIMARY KEY NOT NULL,
	`eight_alarm_id` text NOT NULL,
	`scheduled_for_utc` text,
	`scheduled_local` text,
	`pushed_enabled` integer DEFAULT true NOT NULL,
	`recreated_count` integer DEFAULT 0 NOT NULL,
	`last_pushed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`started_at` text NOT NULL,
	`trigger` text NOT NULL,
	`result` text NOT NULL,
	`error_code` text,
	`message` text,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `sync_log_user_idx` ON `sync_log` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sync_log_started_idx` ON `sync_log` (`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);