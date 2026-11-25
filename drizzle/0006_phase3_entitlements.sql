CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"app_id" text NOT NULL,
	"organization_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"http_status" integer,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"force_state" text,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"state" text NOT NULL,
	"plan_code" text,
	"add_ons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subscription_id" text,
	"period_end" date,
	"version" integer DEFAULT 1 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paywall_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text,
	"feature_key" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upgrade_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text,
	"feature_key" text NOT NULL,
	"requester_id" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"decided_by" text,
	"reason" text,
	"decided_at" timestamp with time zone,
	"return_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"meter" text NOT NULL,
	"quantity" bigint NOT NULL,
	"period_date" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "event_secret_enc" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "previous_event_secret_enc" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "paywall_feature" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_event_id_app_id_index" ON "deliveries" USING btree ("event_id","app_id");--> statement-breakpoint
CREATE INDEX "deliveries_status_next_attempt_at_index" ON "deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "deliveries_organization_id_index" ON "deliveries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "entitlement_overrides_organization_id_app_id_index" ON "entitlement_overrides" USING btree ("organization_id","app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_organization_id_app_id_index" ON "entitlements" USING btree ("organization_id","app_id");--> statement-breakpoint
CREATE INDEX "paywall_events_feature_key_action_index" ON "paywall_events" USING btree ("feature_key","action");--> statement-breakpoint
CREATE INDEX "upgrade_requests_organization_id_status_index" ON "upgrade_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_app_id_idempotency_key_index" ON "usage_records" USING btree ("app_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_records_organization_id_app_id_meter_period_date_index" ON "usage_records" USING btree ("organization_id","app_id","meter","period_date");