CREATE TABLE "answer_feedback_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"answer_key" text NOT NULL,
	"guess" text NOT NULL,
	"tip" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_cache_problem_key_uidx" ON "answer_feedback_cache" USING btree ("problem_id","answer_key");--> statement-breakpoint
CREATE INDEX "answer_feedback_cache_problem_id_idx" ON "answer_feedback_cache" USING btree ("problem_id");