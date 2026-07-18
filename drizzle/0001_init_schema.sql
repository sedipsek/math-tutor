CREATE TYPE "public"."difficulty" AS ENUM('상', '중', '하');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('객관식', '주관식');--> statement-breakpoint
CREATE TYPE "public"."semester" AS ENUM('1학기', '2학기', '공통');--> statement-breakpoint
CREATE TABLE "problem_crops" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"slug" text NOT NULL,
	"crop_index" integer NOT NULL,
	"path" text,
	"body" text
);
--> statement-breakpoint
CREATE TABLE "problem_topics" (
	"problem_id" text NOT NULL,
	"topic_code" text NOT NULL,
	CONSTRAINT "problem_topics_problem_id_topic_code_pk" PRIMARY KEY("problem_id","topic_code")
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" text PRIMARY KEY NOT NULL,
	"question_type" "question_type" NOT NULL,
	"semester" "semester" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"unit_code" text NOT NULL,
	"publisher" text NOT NULL,
	"sourced_at" date NOT NULL,
	"publication_year" text NOT NULL,
	"revision_year" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"unit_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "problem_crops" ADD CONSTRAINT "problem_crops_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_topics" ADD CONSTRAINT "problem_topics_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_topics" ADD CONSTRAINT "problem_topics_topic_code_topics_code_fk" FOREIGN KEY ("topic_code") REFERENCES "public"."topics"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "problem_crops_problem_slug_index_uidx" ON "problem_crops" USING btree ("problem_id","slug","crop_index");--> statement-breakpoint
CREATE INDEX "problem_crops_problem_id_idx" ON "problem_crops" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "problem_topics_topic_code_idx" ON "problem_topics" USING btree ("topic_code");--> statement-breakpoint
CREATE INDEX "problems_unit_code_idx" ON "problems" USING btree ("unit_code");--> statement-breakpoint
CREATE INDEX "problems_difficulty_idx" ON "problems" USING btree ("difficulty");--> statement-breakpoint
CREATE INDEX "problems_semester_idx" ON "problems" USING btree ("semester");--> statement-breakpoint
CREATE INDEX "problems_search_text_trgm_idx" ON "problems" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "topics_unit_code_idx" ON "topics" USING btree ("unit_code");