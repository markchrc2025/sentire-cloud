CREATE TABLE "instances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"base_url" text,
	"tenancy" text DEFAULT 'SHARED' NOT NULL,
	"status" text DEFAULT 'PROVISIONING' NOT NULL,
	"region" text,
	"server_id" text,
	"export_file_url" text,
	"export_sha256" text,
	"export_ready_at" timestamp with time zone,
	"export_expires_at" timestamp with time zone,
	"deletion_certificate_key" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"log" text DEFAULT '' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "instance_paths" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "instances_organization_id_app_id_index" ON "instances" USING btree ("organization_id","app_id");--> statement-breakpoint
CREATE INDEX "instances_status_index" ON "instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_status_next_attempt_at_index" ON "provisioning_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_instance_id_index" ON "provisioning_jobs" USING btree ("instance_id");