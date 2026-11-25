CREATE TABLE "add_ons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"product_id" text,
	"min_plan_rank" integer DEFAULT 0 NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"benefit" text,
	"on_sale" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "add_ons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "billing_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"seller_profile_id" text NOT NULL,
	"subscription_id" text,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"subtotal_centavos" bigint DEFAULT 0 NOT NULL,
	"tax_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint DEFAULT 0 NOT NULL,
	"paid_centavos" bigint DEFAULT 0 NOT NULL,
	"withheld_centavos" bigint DEFAULT 0 NOT NULL,
	"credited_centavos" bigint DEFAULT 0 NOT NULL,
	"seller_snapshot" jsonb NOT NULL,
	"buyer_snapshot" jsonb NOT NULL,
	"bir_invoice_number" text,
	"bir_invoice_recorded_at" timestamp with time zone,
	"void_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount_centavos" bigint NOT NULL,
	"url" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"return_url" text,
	"withholding_atc" text,
	"withholding_basis_points" integer,
	"withholding_centavos" bigint,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"number" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "dunning_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"day_offset" integer NOT NULL,
	"action" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"feature_key" text NOT NULL,
	"plan_id" text,
	"add_on_id" text,
	"limit" integer,
	"limit_mode" text DEFAULT 'HARD' NOT NULL,
	"overage_meter" text
);
--> statement-breakpoint
CREATE TABLE "features" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"benefit" text NOT NULL,
	"product_code" text,
	"limit_unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metered_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text,
	"add_on_id" text,
	"meter" text NOT NULL,
	"included_units" integer DEFAULT 0 NOT NULL,
	"centavos_per_unit" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"token_ref" text NOT NULL,
	"label" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"amount_centavos" bigint NOT NULL,
	"kind" text DEFAULT 'PAYMENT' NOT NULL,
	"idempotency_key" text NOT NULL,
	"reference" text,
	"recorded_by" text,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allows_connections" boolean DEFAULT true NOT NULL,
	"on_sale" boolean DEFAULT true NOT NULL,
	"summary" text,
	"pilot_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text,
	"add_on_id" text,
	"cycle" text NOT NULL,
	"amount_centavos" bigint DEFAULT 0 NOT NULL,
	"setup_fee_centavos" bigint DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"app_id" text NOT NULL,
	"seller_profile_id" text NOT NULL,
	"on_sale" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "seller_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"registered_name" text NOT NULL,
	"trade_name" text,
	"tin" text NOT NULL,
	"branch_code" text DEFAULT '00000' NOT NULL,
	"address" text NOT NULL,
	"tax_status" text DEFAULT 'NON_VAT' NOT NULL,
	"statement_prefix" text NOT NULL,
	"next_statement_number" integer DEFAULT 1 NOT NULL,
	"next_credit_note_number" integer DEFAULT 1 NOT NULL,
	"bank_details" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_profiles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_centavos" bigint NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"service_period_start" date,
	"service_period_end" date,
	"price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"kind" text NOT NULL,
	"price_id" text NOT NULL,
	"add_on_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"cycle" text NOT NULL,
	"anchor_day" integer DEFAULT 1 NOT NULL,
	"current_period_start" date,
	"current_period_end" date,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"scheduled_plan_id" text,
	"scheduled_cycle" text,
	"scheduled_add_on_ids" jsonb,
	"past_due_since" date,
	"grace_until" date,
	"suspended_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"ended_reason" text,
	"payment_method_id" text,
	"pilot_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withholdings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"payment_id" text,
	"atc" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"quarter" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"certificate_key" text,
	"certificate_name" text,
	"uploaded_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reason" text,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_statements" ADD CONSTRAINT "billing_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_statements" ADD CONSTRAINT "billing_statements_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_statements" ADD CONSTRAINT "billing_statements_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_statement_id_billing_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."billing_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_statement_id_billing_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."billing_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_steps" ADD CONSTRAINT "dunning_steps_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_grants" ADD CONSTRAINT "feature_grants_feature_key_features_key_fk" FOREIGN KEY ("feature_key") REFERENCES "public"."features"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_grants" ADD CONSTRAINT "feature_grants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_grants" ADD CONSTRAINT "feature_grants_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metered_rates" ADD CONSTRAINT "metered_rates_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metered_rates" ADD CONSTRAINT "metered_rates_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_statement_id_billing_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."billing_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_billing_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."billing_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_price_id_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withholdings" ADD CONSTRAINT "withholdings_statement_id_billing_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."billing_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_statements_seller_profile_id_number_index" ON "billing_statements" USING btree ("seller_profile_id","number");--> statement-breakpoint
CREATE INDEX "billing_statements_organization_id_issue_date_index" ON "billing_statements" USING btree ("organization_id","issue_date");--> statement-breakpoint
CREATE INDEX "billing_statements_status_due_date_index" ON "billing_statements" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "checkout_sessions_statement_id_index" ON "checkout_sessions" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_sessions_provider_provider_ref_index" ON "checkout_sessions" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_steps_statement_id_day_offset_index" ON "dunning_steps" USING btree ("statement_id","day_offset");--> statement-breakpoint
CREATE INDEX "feature_grants_feature_key_index" ON "feature_grants" USING btree ("feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_index" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_statement_id_index" ON "payments" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_product_id_code_index" ON "plans" USING btree ("product_id","code");--> statement-breakpoint
CREATE INDEX "prices_plan_id_index" ON "prices" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "prices_add_on_id_index" ON "prices" USING btree ("add_on_id");--> statement-breakpoint
CREATE INDEX "statement_lines_statement_id_index" ON "statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "subscription_items_subscription_id_index" ON "subscription_items" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_organization_id_index" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_current_period_end_index" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_id_index" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "withholdings_organization_id_index" ON "withholdings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "withholdings_status_quarter_index" ON "withholdings" USING btree ("status","quarter");