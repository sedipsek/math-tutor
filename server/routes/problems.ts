import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { Hono } from "hono";
import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "../db/client.ts";
import {
  generatedProblems,
  problemCrops,
  problems,
  problemTopics,
  topics,
  units,
} from "../db/schema.ts";
import {
  requireAuth,
  type AuthVariables,
} from "../lib/auth.ts";
import { buildContent, previewText, assetUrl } from "../lib/content.ts";
import {
  assertProblemReadable,
  listExplanations,
  loadExplanationSource,
  replaceExplanations,
} from "../lib/explanations.ts";
import { getOrCreateFeedback } from "../lib/feedback.ts";
import { generateAlternateExplanations } from "../lib/generate.ts";
import { loadGeneratedDetail } from "../lib/generated.ts";
import { fail, parseCsvEnum, parsePagination } from "../lib/http.ts";
import { LlmError } from "../lib/llm.ts";
import { rateLimit } from "../lib/rateLimit.ts";

/** LLM 호출: IP당 1시간 15회 */
const llmLimit = rateLimit({ name: "llm", limit: 15, windowMs: 60 * 60_000 });
import { sseResponse, writeProgress } from "../lib/sse.ts";
import {
  createSimilarHandler,
  createSimilarStreamResponse,
} from "./generated.ts";

export const problemRoutes = new Hono<{ Variables: AuthVariables }>();

const PROBLEMS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../datasets/aihub-secondary/problems",
);

const DIFFICULTIES = ["상", "중", "하"] as const;
const SEMESTERS = ["1학기", "2학기", "공통"] as const;
const QUESTION_TYPES = ["객관식", "주관식"] as const;
const SCHOOLS = ["중학교", "고등학교"] as const;
const POOLS = ["all", "textbook", "ai", "mine"] as const;

type Pool = (typeof POOLS)[number];

type Filters = {
  schools: (typeof SCHOOLS)[number][];
  grades: string[];
  subjects: string[];
  units: string[];
  topics: string[];
  difficulties: (typeof DIFFICULTIES)[number][];
  semesters: (typeof SEMESTERS)[number][];
  questionTypes: (typeof QUESTION_TYPES)[number][];
  q: string | null;
  hasImage: boolean | null;
};

function parseFilters(query: (k: string) => string | undefined):
  | { filters: Filters }
  | { error: string } {
  const difficulties = parseCsvEnum(query("difficulty"), DIFFICULTIES);
  if ("invalid" in difficulties) {
    return { error: `difficulty 값이 잘못됨: ${difficulties.invalid}` };
  }
  const semesters = parseCsvEnum(query("semester"), SEMESTERS);
  if ("invalid" in semesters) {
    return { error: `semester 값이 잘못됨: ${semesters.invalid}` };
  }
  const questionTypes = parseCsvEnum(query("type"), QUESTION_TYPES);
  if ("invalid" in questionTypes) {
    return { error: `type 값이 잘못됨: ${questionTypes.invalid}` };
  }

  const hasImageRaw = query("hasImage");
  let hasImage: boolean | null = null;
  if (hasImageRaw === "true") hasImage = true;
  else if (hasImageRaw === "false") hasImage = false;
  else if (hasImageRaw !== undefined && hasImageRaw !== "") {
    return { error: "hasImage는 true/false만 가능" };
  }

  const schools = parseCsvEnum(query("school"), SCHOOLS);
  if ("invalid" in schools) {
    return { error: `school 값이 잘못됨: ${schools.invalid}` };
  }

  const csv = (raw: string | undefined) =>
    raw
      ? [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))]
      : [];

  return {
    filters: {
      schools,
      grades: csv(query("grade")),
      subjects: csv(query("subject")),
      units: csv(query("unit")),
      topics: csv(query("topic")),
      difficulties,
      semesters,
      questionTypes,
      q: query("q")?.trim() || null,
      hasImage,
    },
  };
}

function parsePool(raw: string | undefined): Pool | { error: string } {
  if (!raw || raw === "") return "all";
  if ((POOLS as readonly string[]).includes(raw)) return raw as Pool;
  return { error: `pool은 ${POOLS.join("|")} 중 하나` };
}

function whereTextbook(filters: Filters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.schools.length) {
    conditions.push(inArray(problems.school, filters.schools));
  }
  if (filters.grades.length) {
    conditions.push(inArray(problems.grade, filters.grades));
  }
  if (filters.subjects.length) {
    conditions.push(inArray(problems.subject, filters.subjects));
  }
  if (filters.units.length) {
    conditions.push(inArray(problems.unitCode, filters.units));
  }
  if (filters.difficulties.length) {
    conditions.push(inArray(problems.difficulty, filters.difficulties));
  }
  if (filters.semesters.length) {
    conditions.push(inArray(problems.semester, filters.semesters));
  }
  if (filters.questionTypes.length) {
    conditions.push(inArray(problems.questionType, filters.questionTypes));
  }
  if (filters.q) {
    conditions.push(ilike(problems.searchText, `%${filters.q}%`));
  }
  if (filters.topics.length) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(problemTopics)
          .where(
            and(
              eq(problemTopics.problemId, problems.id),
              inArray(problemTopics.topicCode, filters.topics),
            ),
          ),
      ),
    );
  }
  if (filters.hasImage !== null) {
    const imageExists = exists(
      db
        .select({ one: sql`1` })
        .from(problemCrops)
        .where(
          and(
            eq(problemCrops.problemId, problems.id),
            eq(problemCrops.slug, "stem_image"),
            isNotNull(problemCrops.path),
          ),
        ),
    );
    conditions.push(
      filters.hasImage ? imageExists : sql`not ${imageExists}`,
    );
  }

  return conditions.length ? and(...conditions) : undefined;
}

/** generated 쪽: topic 필터·hasImage=true면 매칭 0건 */
function whereGenerated(
  filters: Filters,
  pool: "ai" | "mine",
  ownerId: number | null,
): SQL | undefined {
  if (filters.topics.length) return sql`false`;
  if (filters.hasImage === true) return sql`false`;
  if (filters.subjects.length && !filters.subjects.includes("수학")) {
    return sql`false`;
  }

  const conditions: SQL[] = [];
  if (pool === "ai") {
    conditions.push(eq(generatedProblems.origin, "admin"));
  } else {
    conditions.push(eq(generatedProblems.origin, "user"));
    if (ownerId == null) return sql`false`;
    conditions.push(eq(generatedProblems.ownerId, ownerId));
  }

  if (filters.schools.length) {
    conditions.push(inArray(generatedProblems.school, filters.schools));
  }
  if (filters.grades.length) {
    conditions.push(inArray(generatedProblems.grade, filters.grades));
  }
  if (filters.units.length) {
    conditions.push(inArray(generatedProblems.unitCode, filters.units));
  }
  if (filters.difficulties.length) {
    conditions.push(
      inArray(generatedProblems.difficulty, filters.difficulties),
    );
  }
  if (filters.semesters.length) {
    conditions.push(inArray(generatedProblems.semester, filters.semesters));
  }
  if (filters.questionTypes.length) {
    conditions.push(
      inArray(generatedProblems.questionType, filters.questionTypes),
    );
  }
  if (filters.q) {
    conditions.push(ilike(generatedProblems.stem, `%${filters.q}%`));
  }
  if (filters.hasImage === false) {
    // generated는 이미지만 있는 행이 거의 없음 — 전부 포함
  }

  return and(...conditions);
}

async function summariesTextbook(ids: string[]) {
  if (ids.length === 0) return [];

  const [rows, topicRows, cropRows] = await Promise.all([
    db.select().from(problems).where(inArray(problems.id, ids)),
    db
      .select()
      .from(problemTopics)
      .where(inArray(problemTopics.problemId, ids)),
    db
      .select()
      .from(problemCrops)
      .where(
        and(
          inArray(problemCrops.problemId, ids),
          inArray(problemCrops.slug, ["stem_text", "stem_image"]),
        ),
      )
      .orderBy(asc(problemCrops.cropIndex)),
  ]);

  const topicsById = new Map<string, string[]>();
  for (const row of topicRows) {
    (topicsById.get(row.problemId) ??
      topicsById.set(row.problemId, []).get(row.problemId)!)
      .push(row.topicCode);
  }

  const previewById = new Map<string, string>();
  const thumbnailById = new Map<string, string>();
  for (const row of cropRows) {
    if (row.slug === "stem_text" && !previewById.has(row.problemId)) {
      const text = previewText(row.body);
      if (text) previewById.set(row.problemId, text);
    }
    if (
      row.slug === "stem_image" &&
      row.path &&
      !thumbnailById.has(row.problemId)
    ) {
      thumbnailById.set(row.problemId, assetUrl(row.problemId, row.path));
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      school: r.school,
      grade: r.grade,
      subject: r.subject,
      questionType: r.questionType,
      semester: r.semester,
      difficulty: r.difficulty,
      unitCode: r.unitCode,
      topicCodes: topicsById.get(r.id) ?? [],
      preview: previewById.get(r.id) ?? null,
      thumbnail: thumbnailById.get(r.id) ?? null,
      publisher: r.publisher,
      generated: false as const,
      origin: null as null,
    }));
}

async function summariesGenerated(ids: string[]) {
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(generatedProblems)
    .where(inArray(generatedProblems.id, ids));

  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      school: r.school,
      grade: r.grade,
      subject: "수학",
      questionType: r.questionType,
      semester: r.semester,
      difficulty: r.difficulty,
      unitCode: r.unitCode,
      topicCodes: [] as string[],
      preview: r.stem.slice(0, 160),
      thumbnail:
        r.stemImagePath && r.sourceProblemId
          ? assetUrl(r.sourceProblemId, r.stemImagePath)
          : null,
      publisher: r.origin === "admin" ? "AI 생성 (관리자)" : "AI 생성",
      generated: true as const,
      origin: r.origin,
    }));
}

async function detailTextbook(id: string) {
  const [row] = await db
    .select({
      problem: problems,
      unitLabel: units.label,
    })
    .from(problems)
    .innerJoin(units, eq(units.code, problems.unitCode))
    .where(eq(problems.id, id))
    .limit(1);

  if (!row) return null;

  const [topicRows, cropRows] = await Promise.all([
    db
      .select({ code: topics.code, label: topics.label })
      .from(problemTopics)
      .innerJoin(topics, eq(topics.code, problemTopics.topicCode))
      .where(eq(problemTopics.problemId, id))
      .orderBy(asc(topics.code)),
    db
      .select({
        slug: problemCrops.slug,
        cropIndex: problemCrops.cropIndex,
        path: problemCrops.path,
        body: problemCrops.body,
      })
      .from(problemCrops)
      .where(eq(problemCrops.problemId, id)),
  ]);

  const p = row.problem;
  return {
    id: p.id,
    school: p.school,
    grade: p.grade,
    subject: p.subject,
    questionType: p.questionType,
    semester: p.semester,
    difficulty: p.difficulty,
    unitCode: p.unitCode,
    unitLabel: row.unitLabel,
    topics: topicRows,
    publisher: p.publisher,
    sourcedAt: p.sourcedAt,
    publicationYear: p.publicationYear,
    revisionYear: p.revisionYear,
    content: buildContent(p.id, p.questionType, cropRows),
    generated: false as const,
    origin: null as null,
  };
}

type IdKind = { id: string; kind: "textbook" | "generated" };

function textbookIdQuery(filters: Filters) {
  const where = whereTextbook(filters);
  const base = db
    .select({
      id: sql<string>`${problems.id}`.as("id"),
      kind: sql<string>`'textbook'`.as("kind"),
      sortKey: sql<string>`${problems.id}`.as("sort_key"),
    })
    .from(problems);
  return where ? base.where(where) : base;
}

function generatedIdQuery(
  filters: Filters,
  pool: "ai" | "mine",
  ownerId: number | null,
) {
  const where = whereGenerated(filters, pool, ownerId);
  const base = db
    .select({
      id: sql<string>`${generatedProblems.id}`.as("id"),
      kind: sql<string>`'generated'`.as("kind"),
      sortKey: sql<string>`${generatedProblems.id}`.as("sort_key"),
    })
    .from(generatedProblems);
  return where ? base.where(where) : base;
}

async function listIds(
  pool: Pool,
  filters: Filters,
  ownerId: number | null,
  limit: number,
  offset: number,
): Promise<{ total: number; items: IdKind[] }> {
  if (pool === "textbook") {
    const where = whereTextbook(filters);
    const countQ = db.select({ total: count() }).from(problems).$dynamic();
    const idQ = db.select({ id: problems.id }).from(problems).$dynamic();
    const [countRow, idRows] = await Promise.all([
      where ? countQ.where(where) : countQ,
      (where ? idQ.where(where) : idQ)
        .orderBy(asc(problems.id))
        .limit(limit)
        .offset(offset),
    ]);
    return {
      total: countRow[0]?.total ?? 0,
      items: idRows.map((r) => ({ id: r.id, kind: "textbook" as const })),
    };
  }

  if (pool === "ai" || pool === "mine") {
    const where = whereGenerated(filters, pool, ownerId);
    const countQ = db
      .select({ total: count() })
      .from(generatedProblems)
      .$dynamic();
    const idQ = db
      .select({ id: generatedProblems.id })
      .from(generatedProblems)
      .$dynamic();
    const [countRow, idRows] = await Promise.all([
      where ? countQ.where(where) : countQ,
      (where ? idQ.where(where) : idQ)
        .orderBy(asc(generatedProblems.id))
        .limit(limit)
        .offset(offset),
    ]);
    return {
      total: countRow[0]?.total ?? 0,
      items: idRows.map((r) => ({ id: r.id, kind: "generated" as const })),
    };
  }

  // pool === "all": textbook + admin AI
  const united = unionAll(
    textbookIdQuery(filters),
    generatedIdQuery(filters, "ai", ownerId),
  ).as("u");

  const [countRow] = await db
    .select({ total: count() })
    .from(united);

  const idRows = await db
    .select({ id: united.id, kind: united.kind })
    .from(united)
    .orderBy(asc(united.sortKey))
    .limit(limit)
    .offset(offset);

  return {
    total: countRow?.total ?? 0,
    items: idRows.map((r) => ({
      id: r.id,
      kind: r.kind === "generated" ? "generated" : "textbook",
    })),
  };
}

async function pickRandomId(
  pool: Pool,
  filters: Filters,
  ownerId: number | null,
  excludeIds: string[],
): Promise<{ matched: number; pick: IdKind | null }> {
  if (pool === "textbook") {
    const where = whereTextbook(filters);
    const conditions: SQL[] = [];
    if (where) conditions.push(where);
    if (excludeIds.length) {
      conditions.push(notInArray(problems.id, excludeIds));
    }
    const finalWhere = conditions.length ? and(...conditions) : undefined;

    const countQ = db.select({ total: count() }).from(problems).$dynamic();
    const pickQ = db.select({ id: problems.id }).from(problems).$dynamic();

    let [countRow, pick] = await Promise.all([
      where ? countQ.where(where) : countQ,
      (finalWhere ? pickQ.where(finalWhere) : pickQ)
        .orderBy(sql`random()`)
        .limit(1),
    ]);

    if (pick.length === 0 && excludeIds.length) {
      const retry = db.select({ id: problems.id }).from(problems).$dynamic();
      pick = await (where ? retry.where(where) : retry)
        .orderBy(sql`random()`)
        .limit(1);
    }

    return {
      matched: countRow[0]?.total ?? 0,
      pick: pick[0]
        ? { id: pick[0].id, kind: "textbook" }
        : null,
    };
  }

  if (pool === "ai" || pool === "mine") {
    const where = whereGenerated(filters, pool, ownerId);
    const conditions: SQL[] = [];
    if (where) conditions.push(where);
    if (excludeIds.length) {
      conditions.push(notInArray(generatedProblems.id, excludeIds));
    }
    const finalWhere = conditions.length ? and(...conditions) : undefined;

    const countQ = db
      .select({ total: count() })
      .from(generatedProblems)
      .$dynamic();
    const pickQ = db
      .select({ id: generatedProblems.id })
      .from(generatedProblems)
      .$dynamic();

    let [countRow, pick] = await Promise.all([
      where ? countQ.where(where) : countQ,
      (finalWhere ? pickQ.where(finalWhere) : pickQ)
        .orderBy(sql`random()`)
        .limit(1),
    ]);

    if (pick.length === 0 && excludeIds.length) {
      const retry = db
        .select({ id: generatedProblems.id })
        .from(generatedProblems)
        .$dynamic();
      pick = await (where ? retry.where(where) : retry)
        .orderBy(sql`random()`)
        .limit(1);
    }

    return {
      matched: countRow[0]?.total ?? 0,
      pick: pick[0]
        ? { id: pick[0].id, kind: "generated" }
        : null,
    };
  }

  const united = unionAll(
    textbookIdQuery(filters),
    generatedIdQuery(filters, "ai", ownerId),
  ).as("u");

  const [countRow] = await db.select({ total: count() }).from(united);
  const matched = countRow?.total ?? 0;

  let pick = await db
    .select({ id: united.id, kind: united.kind })
    .from(united)
    .where(
      excludeIds.length ? notInArray(united.id, excludeIds) : undefined,
    )
    .orderBy(sql`random()`)
    .limit(1);

  if (pick.length === 0 && excludeIds.length) {
    pick = await db
      .select({ id: united.id, kind: united.kind })
      .from(united)
      .orderBy(sql`random()`)
      .limit(1);
  }

  if (!pick[0]) return { matched, pick: null };
  return {
    matched,
    pick: {
      id: pick[0].id,
      kind: pick[0].kind === "generated" ? "generated" : "textbook",
    },
  };
}

problemRoutes.get("/", async (c) => {
  const parsed = parseFilters((k) => c.req.query(k));
  if ("error" in parsed) return fail(c, 400, "bad_filter", parsed.error);

  const poolParsed = parsePool(c.req.query("pool"));
  if (typeof poolParsed === "object") {
    return fail(c, 400, "bad_filter", poolParsed.error);
  }
  const pool = poolParsed;

  const page = parsePagination(c.req.query("limit"), c.req.query("offset"));
  if ("error" in page) return fail(c, 400, "bad_pagination", page.error);

  const user = c.get("user");
  if (pool === "mine" && !user) {
    return fail(c, 401, "unauthorized", "내 문제는 로그인이 필요해요");
  }

  const { total, items: idKinds } = await listIds(
    pool,
    parsed.filters,
    user?.id ?? null,
    page.limit,
    page.offset,
  );

  const textbookIds = idKinds
    .filter((x) => x.kind === "textbook")
    .map((x) => x.id);
  const generatedIds = idKinds
    .filter((x) => x.kind === "generated")
    .map((x) => x.id);

  const [tb, gen] = await Promise.all([
    summariesTextbook(textbookIds),
    summariesGenerated(generatedIds),
  ]);
  const byId = new Map(
    [...tb, ...gen].map((item) => [item.id, item] as const),
  );
  const items = idKinds
    .map((x) => byId.get(x.id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return c.json({
    total,
    limit: page.limit,
    offset: page.offset,
    items,
  });
});

/** 조건에 맞는 문제 하나를 랜덤으로 — 연습 모드용. exclude로 직전 문제 제외 */
problemRoutes.get("/random", async (c) => {
  const parsed = parseFilters((k) => c.req.query(k));
  if ("error" in parsed) return fail(c, 400, "bad_filter", parsed.error);

  const poolParsed = parsePool(c.req.query("pool"));
  if (typeof poolParsed === "object") {
    return fail(c, 400, "bad_filter", poolParsed.error);
  }
  const pool = poolParsed;

  const user = c.get("user");
  if (pool === "mine" && !user) {
    return fail(c, 401, "unauthorized", "내 문제는 로그인이 필요해요");
  }

  const excludeIds = (c.req.query("exclude") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50);

  const { matched, pick } = await pickRandomId(
    pool,
    parsed.filters,
    user?.id ?? null,
    excludeIds,
  );

  if (!pick) {
    return fail(c, 404, "no_match", "조건에 맞는 문제가 없음");
  }

  if (pick.kind === "generated") {
    const detail = await loadGeneratedDetail(pick.id);
    if (!detail) return fail(c, 404, "no_match", "조건에 맞는 문제가 없음");
    return c.json({ matched, problem: detail });
  }

  const detail = await detailTextbook(pick.id);
  return c.json({ matched, problem: detail });
});

problemRoutes.post("/:id/similar", requireAuth, llmLimit, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  if (!id) return fail(c, 400, "bad_path", "문제 id 필요");
  const result = await createSimilarHandler(id, user, {
    signal: c.req.raw.signal,
  });
  if (!result.ok) {
    return fail(c, result.status, result.code, result.message);
  }
  return c.json(result.detail);
});

problemRoutes.post("/:id/similar/stream", requireAuth, llmLimit, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  if (!id) return fail(c, 400, "bad_path", "문제 id 필요");
  return createSimilarStreamResponse(c, id, user);
});

problemRoutes.post("/:id/feedback", requireAuth, llmLimit, async (c) => {
  const id = c.req.param("id");
  if (!id) return fail(c, 400, "bad_path", "문제 id 필요");

  const access = await assertProblemReadable(id, c.get("user"));
  if (!access.ok) {
    return fail(c, access.status, access.code, access.message);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "bad_body", "JSON 본문 필요");
  }

  const correct = body.correct === true;
  const userAnswer =
    typeof body.userAnswer === "string" ? body.userAnswer.trim() : "";
  const choiceMarker =
    typeof body.choiceMarker === "string" && body.choiceMarker.trim()
      ? body.choiceMarker.trim()
      : undefined;

  if (!correct && !choiceMarker && !userAnswer) {
    return fail(
      c,
      400,
      "bad_body",
      "오답 피드백에는 선택지 또는 작성한 답이 필요해요",
    );
  }

  const source = await loadExplanationSource(id);
  if (!source) return fail(c, 404, "not_found", "문제 없음");

  try {
    const result = await getOrCreateFeedback({
      problemId: id,
      source,
      correct,
      userAnswer:
        userAnswer ||
        (choiceMarker ? `${choiceMarker}` : correct ? "(정답)" : ""),
      choiceMarker,
      signal: c.req.raw.signal,
    });
    return c.json({
      guess: result.guess,
      tip: result.tip,
      model: result.model,
      cached: result.cached,
    });
  } catch (err) {
    const message =
      err instanceof LlmError
        ? err.message
        : err instanceof Error
          ? err.message
          : "피드백 생성 실패";
    return fail(c, 502, "feedback_failed", message);
  }
});

problemRoutes.get("/:id/explanations", async (c) => {
  const id = c.req.param("id");
  if (!id) return fail(c, 400, "bad_path", "문제 id 필요");

  const access = await assertProblemReadable(id, c.get("user"));
  if (!access.ok) {
    return fail(c, access.status, access.code, access.message);
  }

  const items = await listExplanations(id);
  return c.json({ items });
});

problemRoutes.post(
  "/:id/explanations/stream",
  requireAuth,
  llmLimit,
  async (c) => {
    const id = c.req.param("id");
    if (!id) return fail(c, 400, "bad_path", "문제 id 필요");

    const access = await assertProblemReadable(id, c.get("user"));
    if (!access.ok) {
      return fail(c, access.status, access.code, access.message);
    }

    const source = await loadExplanationSource(id);
    if (!source) {
      return fail(c, 404, "not_found", "문제 없음");
    }

    const signal = c.req.raw.signal;

    return sseResponse(c, async (stream) => {
      let pair;
      try {
        pair = await generateAlternateExplanations(source, {
          signal,
          onProgress: (ev) => writeProgress(stream, ev),
        });
      } catch (err) {
        const message =
          err instanceof LlmError
            ? err.message
            : err instanceof Error
              ? err.message
              : "다른 풀이 생성 실패";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message }),
        });
        return;
      }

      await writeProgress(stream, { type: "stage", stage: "save" });
      const items = await replaceExplanations(id, pair);

      for (const explanation of items) {
        await stream.writeSSE({
          event: "item",
          data: JSON.stringify({ explanation }),
        });
      }

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ count: items.length }),
      });
    });
  },
);

problemRoutes.get("/:id/assets/*", async (c) => {
  const id = c.req.param("id");
  const rel = decodeURIComponent(
    c.req.path.split("/assets/")[1] ?? "",
  );

  if (!rel || rel.includes("\0")) {
    return fail(c, 400, "bad_path", "잘못된 경로");
  }

  const problemDir = path.resolve(PROBLEMS_ROOT, id);
  const target = path.resolve(problemDir, rel);
  if (
    !problemDir.startsWith(PROBLEMS_ROOT + path.sep) ||
    !target.startsWith(problemDir + path.sep)
  ) {
    return fail(c, 403, "forbidden", "접근 불가");
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    return fail(c, 404, "not_found", "파일 없음");
  }
  if (!info.isFile()) return fail(c, 404, "not_found", "파일 없음");

  const ext = path.extname(target).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "application/octet-stream";

  const stream = Readable.toWeb(
    createReadStream(target),
  ) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(info.size),
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
});

problemRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  if (id.startsWith("gen_")) {
    const [row] = await db
      .select({
        origin: generatedProblems.origin,
        ownerId: generatedProblems.ownerId,
      })
      .from(generatedProblems)
      .where(eq(generatedProblems.id, id))
      .limit(1);

    if (!row) return fail(c, 404, "not_found", "문제 없음");

    if (row.origin === "user") {
      const user = c.get("user");
      if (!user || (user.role !== "admin" && user.id !== row.ownerId)) {
        return fail(c, 403, "forbidden", "이 문제에 접근할 수 없어요");
      }
    }

    const detail = await loadGeneratedDetail(id);
    if (!detail) return fail(c, 404, "not_found", "문제 없음");
    return c.json(detail);
  }

  const detail = await detailTextbook(id);
  if (!detail) return fail(c, 404, "not_found", "문제 없음");
  return c.json(detail);
});
