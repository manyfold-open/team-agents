CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_key` text NOT NULL,
	`context_id` text,
	`active_task_id` text,
	`config_version` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversations_scope_unique` ON `agent_conversations` (`agent_id`,`channel_id`,`thread_key`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_root_id` integer,
	`trigger_message_id` integer NOT NULL,
	`response_message_id` integer NOT NULL,
	`status` text NOT NULL,
	`remote_task_id` text,
	`remote_context_id` text,
	`last_error` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_trigger_agent_unique` ON `agent_runs` (`trigger_message_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_conversation_idx` ON `agent_runs` (`agent_id`,`channel_id`,`thread_root_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`handle` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rpc_url` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_iv` text NOT NULL,
	`history_count` integer DEFAULT 20 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_workspace_handle_unique` ON `agents` (`workspace_id`,`handle`);--> statement-breakpoint
CREATE INDEX `agents_owner_idx` ON `agents` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`count` integer NOT NULL,
	`blocked_until` text
);
--> statement-breakpoint
CREATE TABLE `channel_agents` (
	`channel_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`added_by` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`channel_id`, `agent_id`)
);
--> statement-breakpoint
CREATE INDEX `channel_agents_agent_idx` ON `channel_agents` (`agent_id`);--> statement-breakpoint
CREATE TABLE `channel_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `channel_events_channel_idx` ON `channel_events` (`channel_id`,`id`);--> statement-breakpoint
CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `channel_members_user_idx` ON `channel_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_workspace_slug_unique` ON `channels` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `channels_workspace_idx` ON `channels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `message_mentions` (
	`message_id` integer NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	PRIMARY KEY(`message_id`, `kind`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_message_id` text,
	`channel_id` text NOT NULL,
	`thread_root_id` integer,
	`sender_type` text NOT NULL,
	`sender_user_id` text,
	`sender_agent_id` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_channel_client_unique` ON `messages` (`channel_id`,`client_message_id`);--> statement-breakpoint
CREATE INDEX `messages_channel_id_idx` ON `messages` (`channel_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_root_id`,`id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`message_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`)
);
--> statement-breakpoint
CREATE TABLE `read_cursors` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_message_id` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`created_at` text NOT NULL,
	`disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` (`username_normalized`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
