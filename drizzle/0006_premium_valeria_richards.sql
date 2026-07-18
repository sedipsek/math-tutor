CREATE TABLE "generated_explanations" (
	"id" text PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"slot" smallint NOT NULL,
	"method_label" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "generated_explanations_problem_slot_uidx" ON "generated_explanations" USING btree ("problem_id","slot");--> statement-breakpoint
CREATE INDEX "generated_explanations_problem_id_idx" ON "generated_explanations" USING btree ("problem_id");