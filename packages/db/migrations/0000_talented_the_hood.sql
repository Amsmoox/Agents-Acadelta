CREATE TYPE "public"."agc_organization_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "agc_organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"mission" text,
	"status" "agc_organization_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agc_organizations_slug_lower_key" ON "agc_organizations" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "agc_organizations_status_created_idx" ON "agc_organizations" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);