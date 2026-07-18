TRUNCATE TABLE "problems" CASCADE;--> statement-breakpoint
DELETE FROM "topics";--> statement-breakpoint
DELETE FROM "units";--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "school" text NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "grade" text NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "subject" text NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "school" text NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "grade" text NOT NULL;--> statement-breakpoint
CREATE INDEX "problems_school_grade_idx" ON "problems" USING btree ("school","grade");--> statement-breakpoint
CREATE INDEX "units_school_grade_idx" ON "units" USING btree ("school","grade");
