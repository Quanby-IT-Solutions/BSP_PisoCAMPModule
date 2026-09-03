CREATE TABLE "push_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"notification_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_delivery_notification_account_unique" UNIQUE("notification_id","account_id"),
	CONSTRAINT "push_delivery_status_check" CHECK ("status" in ('queued', 'delivered', 'failed')),
	CONSTRAINT "push_delivery_shape_check" CHECK (("status" = 'queued' and "failure_reason" is null and "delivered_at" is null)
				or ("status" = 'delivered' and "failure_reason" is null and "delivered_at" is not null)
				or ("status" = 'failed' and "failure_reason" is not null and "delivered_at" is null)),
	CONSTRAINT "push_delivery_order_check" CHECK (("opened_at" is null or "delivered_at" is not null)
				and ("clicked_at" is null or "opened_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "push_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" text NOT NULL,
	"body" text NOT NULL,
	"deep_link" text,
	"approval_reference" text NOT NULL,
	"sent_by" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipients" integer NOT NULL,
	CONSTRAINT "push_notification_title_check" CHECK ("title" = btrim("title") and char_length("title") between 1 and 120),
	CONSTRAINT "push_notification_body_check" CHECK ("body" = btrim("body") and char_length("body") between 1 and 500),
	CONSTRAINT "push_notification_approval_check" CHECK ("approval_reference" = btrim("approval_reference")
				and char_length("approval_reference") between 1 and 120),
	CONSTRAINT "push_notification_deep_link_check" CHECK ("deep_link" is null or "deep_link" ~ '^/[A-Za-z0-9/_.:-]{0,200}$'),
	CONSTRAINT "push_notification_recipients_check" CHECK ("recipients" >= 0)
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" text NOT NULL,
	"device_token" text NOT NULL CONSTRAINT "push_subscription_device_token_unique" UNIQUE,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_platform_check" CHECK ("platform" in ('android', 'ios', 'web')),
	CONSTRAINT "push_subscription_token_check" CHECK (char_length("device_token") between 16 and 512
				and "device_token" = btrim("device_token"))
);
--> statement-breakpoint
CREATE INDEX "push_delivery_notification_idx" ON "push_delivery" ("notification_id");--> statement-breakpoint
CREATE INDEX "push_delivery_opened_idx" ON "push_delivery" ("opened_at");--> statement-breakpoint
CREATE INDEX "push_notification_sent_at_idx" ON "push_notification" ("sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "push_subscription_account_idx" ON "push_subscription" ("account_id");--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_notification_id_push_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "push_notification"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_notification" ADD CONSTRAINT "push_notification_sent_by_users_id_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE CASCADE;