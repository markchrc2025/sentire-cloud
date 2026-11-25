CREATE TABLE "app_access" (
	"organization_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"app_id" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	CONSTRAINT "app_access_membership_id_app_id_pk" PRIMARY KEY("membership_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"app_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"secret" text NOT NULL,
	"credential_id" text,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"last_time_step" integer,
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"registered_name" text NOT NULL,
	"trade_name" text,
	"tin" text NOT NULL,
	"branch_code" text DEFAULT '00000' NOT NULL,
	"address" text NOT NULL,
	"vat_status" text NOT NULL,
	"industry" text,
	"billing_email" text NOT NULL,
	"phone" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"flagged_duplicate_tin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"html" text,
	"template" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_ref" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"pending_mfa" boolean DEFAULT false NOT NULL,
	"current_organization_id" text,
	"device_label" text,
	"ip_address" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"platform_role" text DEFAULT 'NONE' NOT NULL,
	"failed_sign_ins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"marketing_consent_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"base_url" text NOT NULL,
	"oidc_client_id" text NOT NULL,
	"oidc_client_secret_enc" text,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_logout_redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backchannel_logout_uri" text,
	"event_endpoint" text,
	"provision_url" text,
	"health_url" text,
	"sends_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepts_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_appId_unique" UNIQUE("app_id"),
	CONSTRAINT "apps_oidcClientId_unique" UNIQUE("oidc_client_id")
);
--> statement-breakpoint
CREATE TABLE "oidc_grant_orgs" (
	"grant_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_payloads" (
	"id" text NOT NULL,
	"model" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"user_code" text,
	"uid" text,
	"account_id" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"alg" text DEFAULT 'ES256' NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_jwk_enc" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "signing_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
ALTER TABLE "app_access" ADD CONSTRAINT "app_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_access" ADD CONSTRAINT "app_access_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_access_organization_id_index" ON "app_access" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_token_hash_index" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_index" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_organization_id_index" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_organization_id_user_id_index" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_index" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mfa_factors_user_id_index" ON "mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_factors_credential_id_index" ON "mfa_factors" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "organizations_tin_branch_code_index" ON "organizations" USING btree ("tin","branch_code");--> statement-breakpoint
CREATE INDEX "outbound_emails_to_created_at_index" ON "outbound_emails" USING btree ("to","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_index" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_payloads_pk" ON "oidc_payloads" USING btree ("model","id");--> statement-breakpoint
CREATE INDEX "oidc_payloads_grant_id_index" ON "oidc_payloads" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oidc_payloads_uid_index" ON "oidc_payloads" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "oidc_payloads_account_id_index" ON "oidc_payloads" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "oidc_payloads_expires_at_index" ON "oidc_payloads" USING btree ("expires_at");