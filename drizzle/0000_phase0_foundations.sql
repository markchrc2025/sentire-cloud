CREATE TABLE "audit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"actor_id" text,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"up" boolean NOT NULL,
	"slow" boolean DEFAULT false NOT NULL,
	"http_status" integer DEFAULT 0 NOT NULL,
	"ms" integer NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"note" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_entries_organization_id_at_index" ON "audit_entries" USING btree ("organization_id","at");--> statement-breakpoint
CREATE INDEX "audit_entries_entity_entity_id_index" ON "audit_entries" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "health_checks_service_id_at_index" ON "health_checks" USING btree ("service_id","at");--> statement-breakpoint
CREATE INDEX "incidents_service_id_status_index" ON "incidents" USING btree ("service_id","status");