CREATE TABLE "agc_agent_instruction_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agc_agent_skills" (
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agc_agent_skills_agent_id_skill_id_pk" PRIMARY KEY("agent_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "agc_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agc_skills_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "agc_agent_instruction_files" ADD CONSTRAINT "agc_agent_instruction_files_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_agent_skills" ADD CONSTRAINT "agc_agent_skills_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_agent_skills" ADD CONSTRAINT "agc_agent_skills_org_skill_fk" FOREIGN KEY ("organization_id","skill_id") REFERENCES "public"."agc_skills"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_skills" ADD CONSTRAINT "agc_skills_organization_id_agc_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."agc_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agc_agent_instruction_files_agent_path_key" ON "agc_agent_instruction_files" USING btree ("agent_id","path");--> statement-breakpoint
CREATE INDEX "agc_agent_skills_skill_idx" ON "agc_agent_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agc_skills_org_slug_key" ON "agc_skills" USING btree ("organization_id",lower("slug"));--> statement-breakpoint
CREATE INDEX "agc_skills_org_created_idx" ON "agc_skills" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);