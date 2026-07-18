import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const questionTypeEnum = pgEnum("question_type", ["객관식", "주관식"]);
export const semesterEnum = pgEnum("semester", ["1학기", "2학기", "공통"]);
export const difficultyEnum = pgEnum("difficulty", ["상", "중", "하"]);
export const userRoleEnum = pgEnum("user_role", ["student", "admin"]);
export const generatedOriginEnum = pgEnum("generated_origin", [
  "admin",
  "user",
]);

export const units = pgTable(
  "units",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    school: text("school").notNull(),
    grade: text("grade").notNull(),
  },
  (t) => [index("units_school_grade_idx").on(t.school, t.grade)],
);

export const topics = pgTable(
  "topics",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    unitCode: text("unit_code")
      .notNull()
      .references(() => units.code, { onDelete: "restrict" }),
  },
  (t) => [index("topics_unit_code_idx").on(t.unitCode)],
);

export const problems = pgTable(
  "problems",
  {
    id: text("id").primaryKey(),
    school: text("school").notNull(),
    grade: text("grade").notNull(),
    subject: text("subject").notNull(),
    questionType: questionTypeEnum("question_type").notNull(),
    semester: semesterEnum("semester").notNull(),
    difficulty: difficultyEnum("difficulty").notNull(),
    unitCode: text("unit_code")
      .notNull()
      .references(() => units.code, { onDelete: "restrict" }),
    publisher: text("publisher").notNull(),
    sourcedAt: date("sourced_at").notNull(),
    publicationYear: text("publication_year").notNull(),
    revisionYear: text("revision_year").notNull(),
    searchText: text("search_text").notNull().default(""),
  },
  (t) => [
    index("problems_unit_code_idx").on(t.unitCode),
    index("problems_difficulty_idx").on(t.difficulty),
    index("problems_semester_idx").on(t.semester),
    index("problems_school_grade_idx").on(t.school, t.grade),
    index("problems_search_text_trgm_idx").using(
      "gin",
      sql`${t.searchText} gin_trgm_ops`,
    ),
  ],
);

export const problemTopics = pgTable(
  "problem_topics",
  {
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    topicCode: text("topic_code")
      .notNull()
      .references(() => topics.code, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.problemId, t.topicCode] }),
    index("problem_topics_topic_code_idx").on(t.topicCode),
  ],
);

export const problemCrops = pgTable(
  "problem_crops",
  {
    id: serial("id").primaryKey(),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    cropIndex: integer("crop_index").notNull(),
    path: text("path"),
    body: text("body"),
  },
  (t) => [
    uniqueIndex("problem_crops_problem_slug_index_uidx").on(
      t.problemId,
      t.slug,
      t.cropIndex,
    ),
    index("problem_crops_problem_id_idx").on(t.problemId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_username_uidx").on(t.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

/** LLM이 만든 유사/조건 문제. AI Hub 원본과 분리 (ingest truncate에 안 걸림). */
export type GeneratedChoiceRow = { text: string; isAnswer: boolean };

export const generatedProblems = pgTable(
  "generated_problems",
  {
    id: text("id").primaryKey(),
    sourceProblemId: text("source_problem_id"),
    school: text("school").notNull(),
    grade: text("grade").notNull(),
    unitCode: text("unit_code").notNull(),
    difficulty: difficultyEnum("difficulty").notNull(),
    questionType: questionTypeEnum("question_type").notNull(),
    semester: semesterEnum("semester").notNull().default("공통"),
    stem: text("stem").notNull(),
    choices: jsonb("choices").$type<GeneratedChoiceRow[] | null>(),
    answer: text("answer").notNull(),
    explanation: text("explanation").notNull(),
    /** 원본 problems/{source}/ 기준 상대경로. 있으면 원본 stem_image 재사용 */
    stemImagePath: text("stem_image_path"),
    origin: generatedOriginEnum("origin").notNull(),
    ownerId: integer("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("generated_problems_source_idx").on(t.sourceProblemId),
    index("generated_problems_created_at_idx").on(t.createdAt),
    index("generated_problems_origin_idx").on(t.origin),
    index("generated_problems_owner_id_idx").on(t.ownerId),
  ],
);

/** 문제당 AI 다른 풀이 2개 (공유). problem_id는 교재 id 또는 gen_* */
export const generatedExplanations = pgTable(
  "generated_explanations",
  {
    id: text("id").primaryKey(),
    problemId: text("problem_id").notNull(),
    slot: smallint("slot").notNull(),
    methodLabel: text("method_label").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("generated_explanations_problem_slot_uidx").on(
      t.problemId,
      t.slot,
    ),
    index("generated_explanations_problem_id_idx").on(t.problemId),
  ],
);

/** 같은 오답/정답 키에 대한 AI 피드백 캐시 */
export const answerFeedbackCache = pgTable(
  "answer_feedback_cache",
  {
    id: serial("id").primaryKey(),
    problemId: text("problem_id").notNull(),
    answerKey: text("answer_key").notNull(),
    guess: text("guess").notNull(),
    tip: text("tip").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("answer_feedback_cache_problem_key_uidx").on(
      t.problemId,
      t.answerKey,
    ),
    index("answer_feedback_cache_problem_id_idx").on(t.problemId),
  ],
);
