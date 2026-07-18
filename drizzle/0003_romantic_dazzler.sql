CREATE TABLE "generated_problems" (
	"id" text PRIMARY KEY NOT NULL,
	"source_problem_id" text NOT NULL,
	"school" text NOT NULL,
	"grade" text NOT NULL,
	"unit_code" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"question_type" "question_type" NOT NULL,
	"stem" text NOT NULL,
	"choices" jsonb,
	"answer" text NOT NULL,
	"explanation" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "generated_problems_source_idx" ON "generated_problems" USING btree ("source_problem_id");--> statement-breakpoint
CREATE INDEX "generated_problems_created_at_idx" ON "generated_problems" USING btree ("created_at");