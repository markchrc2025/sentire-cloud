CREATE TABLE "webauthn_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"organization_id" text,
	"data" jsonb NOT NULL,
	"direction" text DEFAULT 'OUT' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "events_event_id_index" ON "events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_organization_id_received_at_index" ON "events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "events_type_index" ON "events" USING btree ("type");