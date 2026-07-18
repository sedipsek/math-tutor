CREATE TYPE "public"."generated_origin" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'admin');--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_problems" ALTER COLUMN "source_problem_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_problems" ADD COLUMN "semester" "semester" DEFAULT '공통' NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_problems" ADD COLUMN "origin" "generated_origin";--> statement-breakpoint
UPDATE "generated_problems" SET "origin" = 'user' WHERE "origin" IS NULL;--> statement-breakpoint
ALTER TABLE "generated_problems" ALTER COLUMN "origin" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_problems" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uidx" ON "users" USING btree ("username");--> statement-breakpoint
ALTER TABLE "generated_problems" ADD CONSTRAINT "generated_problems_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_problems_origin_idx" ON "generated_problems" USING btree ("origin");--> statement-breakpoint
CREATE INDEX "generated_problems_owner_id_idx" ON "generated_problems" USING btree ("owner_id");
