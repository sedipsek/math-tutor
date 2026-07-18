import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inArray, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { seedCatalog } from "./catalog.ts";
import {
  problemCrops,
  problems,
  problemTopics,
} from "./schema.ts";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../datasets/aihub-secondary/problems",
);

const BATCH_SIZE = 100;

const QUESTION_TYPES = new Set(["객관식", "주관식"]);
const SEMESTERS = new Set(["1학기", "2학기", "공통"]);
const DIFFICULTIES = new Set(["상", "중", "하"]);
const SCHOOLS = new Set(["중학교", "고등학교"]);

type ProblemJson = {
  id: string;
  school: string;
  grade: string;
  subject: string;
  question_type: string;
  semester: string;
  difficulty: string;
  topic_codes: string[];
  unit_codes: string[];
  date: string;
  publisher: string;
  publication_year: string;
  revision_year: string;
  quality?: { status: "ready" | "quarantined"; issues: string[] };
  crops: Array<{
    slug: string;
    index: number;
    path: string | null;
    text: string | null;
  }>;
};

type ParsedProblem = {
  problem: typeof problems.$inferInsert;
  topics: Array<typeof problemTopics.$inferInsert>;
  crops: Array<typeof problemCrops.$inferInsert>;
};

function assertEnum(
  value: string,
  allowed: Set<string>,
  field: string,
  id: string,
) {
  if (!allowed.has(value)) {
    throw new Error(`${id}: invalid ${field}=${value}`);
  }
}

function parseProblem(raw: ProblemJson): ParsedProblem {
  assertEnum(raw.school, SCHOOLS, "school", raw.id);
  assertEnum(raw.question_type, QUESTION_TYPES, "question_type", raw.id);
  assertEnum(raw.semester, SEMESTERS, "semester", raw.id);
  assertEnum(raw.difficulty, DIFFICULTIES, "difficulty", raw.id);

  if (!raw.grade?.trim()) {
    throw new Error(`${raw.id}: missing grade`);
  }
  if (!raw.subject?.trim()) {
    throw new Error(`${raw.id}: missing subject`);
  }
  if (!raw.unit_codes?.length) {
    throw new Error(`${raw.id}: missing unit_codes`);
  }
  if (!raw.topic_codes?.length) {
    throw new Error(`${raw.id}: missing topic_codes`);
  }

  const searchText = raw.crops
    .map((c) => c.text?.trim())
    .filter((t): t is string => Boolean(t))
    .join("\n");

  return {
    problem: {
      id: raw.id,
      school: raw.school,
      grade: raw.grade,
      subject: raw.subject,
      questionType: raw.question_type as "객관식" | "주관식",
      semester: raw.semester as "1학기" | "2학기" | "공통",
      difficulty: raw.difficulty as "상" | "중" | "하",
      unitCode: raw.unit_codes[0]!,
      publisher: raw.publisher,
      sourcedAt: raw.date,
      publicationYear: raw.publication_year,
      revisionYear: raw.revision_year,
      searchText,
    },
    topics: [...new Set(raw.topic_codes)].map((topicCode) => ({
      problemId: raw.id,
      topicCode,
    })),
    crops: raw.crops.map((c) => ({
      problemId: raw.id,
      slug: c.slug,
      cropIndex: c.index,
      path: c.path,
      body: c.text,
    })),
  };
}

async function loadAll(): Promise<ParsedProblem[]> {
  const dirs = await readdir(ROOT, { withFileTypes: true });
  const parsed: ParsedProblem[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(ROOT, dir.name, "problem.json");
    const raw = JSON.parse(await readFile(file, "utf8")) as ProblemJson;
    if (raw.quality?.status === "quarantined") continue;
    parsed.push(parseProblem(raw));
  }

  parsed.sort((a, b) => a.problem.id.localeCompare(b.problem.id));
  return parsed;
}

function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

async function ingestBatch(batch: ParsedProblem[]) {
  const ids = batch.map((b) => b.problem.id);
  const problemRows = batch.map((b) => b.problem);
  const topicRows = batch.flatMap((b) => b.topics);
  const cropRows = batch.flatMap((b) => b.crops);

  await db.transaction(async (tx) => {
    await tx
      .insert(problems)
      .values(problemRows)
      .onConflictDoUpdate({
        target: problems.id,
        set: {
          school: excluded("school"),
          grade: excluded("grade"),
          subject: excluded("subject"),
          questionType: excluded("question_type"),
          semester: excluded("semester"),
          difficulty: excluded("difficulty"),
          unitCode: excluded("unit_code"),
          publisher: excluded("publisher"),
          sourcedAt: excluded("sourced_at"),
          publicationYear: excluded("publication_year"),
          revisionYear: excluded("revision_year"),
          searchText: excluded("search_text"),
        },
      });

    await tx.delete(problemTopics).where(inArray(problemTopics.problemId, ids));
    if (topicRows.length) {
      await tx.insert(problemTopics).values(topicRows);
    }

    await tx.delete(problemCrops).where(inArray(problemCrops.problemId, ids));
    if (cropRows.length) {
      await tx.insert(problemCrops).values(cropRows);
    }
  });
}

async function main() {
  console.log(`reading ${ROOT}`);
  const catalog = await seedCatalog();
  console.log(`catalog ready (${catalog.units} units, ${catalog.topics} topics)`);

  console.log("wiping problems…");
  await db.execute(sql`truncate table problems cascade`);

  const all = await loadAll();
  console.log(`loaded ${all.length} problems`);

  let done = 0;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);
    await ingestBatch(batch);
    done += batch.length;
    console.log(`ingested ${done}/${all.length}`);
  }

  const counts = await db.execute(sql`
    select
      (select count(*) from problems) as problems,
      (select count(*) from problem_topics) as problem_topics,
      (select count(*) from problem_crops) as problem_crops,
      (select count(distinct school) from problems) as schools,
      (select count(distinct grade) from problems) as grades
  `);

  console.log("done", counts[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
