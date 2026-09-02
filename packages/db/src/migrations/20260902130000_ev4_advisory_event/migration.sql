ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_name_check", ADD CONSTRAINT "analytics_event_name_check" CHECK ("event_name" in ('module_entry', 'account_prompt_shown', 'account_prompt_guest',
				'content_view', 'feature_use', 'link_open', 'trivia_prompt_shown',
				'trivia_prompt_answered', 'trivia_prompt_skipped', 'survey_prompt_shown',
				'survey_declined', 'survey_submitted', 'advisory_shown'));--> statement-breakpoint
ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_catalog_check", ADD CONSTRAINT "analytics_event_catalog_check" CHECK ((
				("event_name" = 'module_entry' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'completed')
				or ("event_name" = 'account_prompt_shown' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'account_prompt_guest' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'content_view' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
				or ("event_name" = 'link_open' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
				or ("event_name" = 'feature_use' and "screen" in ('coin_3d_viewer', 'tactile_viewer', 'tilt_viewer') and "feature" in ('3d_coin', 'haptic', 'tilt') and "status" = 'completed')
				or ("event_name" in ('trivia_prompt_shown', 'trivia_prompt_answered', 'trivia_prompt_skipped') and "screen" = 'trivia_prompt' and "feature" = 'trivia' and "status" = 'completed')
				or ("event_name" in ('survey_prompt_shown', 'survey_declined', 'survey_submitted') and "screen" = 'survey_prompt' and "feature" = 'survey' and "status" = 'completed')
				or ("event_name" = 'advisory_shown' and "screen" = 'exit_advisory' and "feature" = 'advisory' and "status" = 'completed')
			));