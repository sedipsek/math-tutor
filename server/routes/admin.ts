import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
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
  requireAdmin,
  type AuthVariables,
} from "../lib/auth.ts";
import { buildContent } from "../lib/content.ts";
import {
  generateFromConditions,
  type ConditionSpec,
  type SourceContext,
} from "../lib/generate.ts";
import {
  newGeneratedId,
  toGeneratedDetail,
} from "../lib/generated.ts";
import { fail, parsePagination } from "../lib/http.ts";
import { LlmError } from "../lib/llm.ts";
import { sseResponse, writeProgress } from "../lib/sse.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const adminRoutes = new Hono<{ Variables: AuthVariables }>();

adminRoutes.use("*", requireAdmin);

const PROBLEMS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../datasets/aihub-secondary/problems",
);

const DIFFICULTIES = ["상", "중", "하"] as const;
const QUESTION_TYPES = ["객관식", "주관식"] as const;

async function loadSourceContext(id: string): Promise<SourceContext | null> {
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
  const content = buildContent(p.id, p.questionType, cropRows);
  const stemImages = cropRows
    .filter((c) => c.slug === "stem_image" && c.path)
    .sort((a, b) => a.cropIndex - b.cropIndex)
    .map((c) => ({
      relPath: c.path!,
      absPath: path.resolve(PROBLEMS_ROOT, id, c.path!),
    }));

  return {
    id: p.id,
    school: p.school,
    grade: p.grade,
    subject: p.subject,
    questionType: p.questionType,
    difficulty: p.difficulty,
    semester: p.semester,
    unitCode: p.unitCode,
    unitLabel: row.unitLabel,
    topics: topicRows,
    content,
    hasStemImage: stemImages.length > 0,
    stemImages,
  };
}

async function sampleRefs(cond: ConditionSpec, limit = 3): Promise<SourceContext[]> {
  const conditions = [
    eq(problems.school, cond.school),
    eq(problems.grade, cond.grade),
    eq(problems.unitCode, cond.unitCode),
    eq(problems.difficulty, cond.difficulty),
    eq(problems.questionType, cond.questionType),
  ];

  let idRows = await db
    .select({ id: problems.id })
    .from(problems)
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(limit);

  // 같은 조건이 부족하면 단원+유형만으로 완화
  if (idRows.length < 2) {
    idRows = await db
      .select({ id: problems.id })
      .from(problems)
      .where(
        and(
          eq(problems.school, cond.school),
          eq(problems.grade, cond.grade),
          eq(problems.unitCode, cond.unitCode),
          eq(problems.questionType, cond.questionType),
        ),
      )
      .orderBy(sql`random()`)
      .limit(limit);
  }

  const refs: SourceContext[] = [];
  for (const { id } of idRows) {
    const ctx = await loadSourceContext(id);
    if (ctx) refs.push(ctx);
  }
  return refs;
}

type ParsedGenerate =
  | {
      ok: true;
      cond: ConditionSpec;
      count: number;
      topicTopics: Array<{ code: string; label: string }>;
    }
  | { ok: false; status: 400 | 404; code: string; message: string };

async function parseGenerateBody(
  body: Record<string, unknown>,
): Promise<ParsedGenerate> {
  const school = typeof body.school === "string" ? body.school.trim() : "";
  const grade = typeof body.grade === "string" ? body.grade.trim() : "";
  const unitCode =
    typeof body.unitCode === "string" ? body.unitCode.trim() : "";
  const difficulty = body.difficulty as (typeof DIFFICULTIES)[number];
  const questionType = body.questionType as (typeof QUESTION_TYPES)[number];
  const topicCode =
    typeof body.topicCode === "string" && body.topicCode.trim()
      ? body.topicCode.trim()
      : undefined;
  const countRaw = Number(body.count ?? 1);
  const count = Number.isFinite(countRaw)
    ? Math.min(5, Math.max(1, Math.trunc(countRaw)))
    : 1;

  if (!school || !grade || !unitCode) {
    return {
      ok: false,
      status: 400,
      code: "bad_body",
      message: "school, grade, unitCode 필요",
    };
  }
  if (!DIFFICULTIES.includes(difficulty)) {
    return {
      ok: false,
      status: 400,
      code: "bad_body",
      message: "difficulty는 상/중/하",
    };
  }
  if (!QUESTION_TYPES.includes(questionType)) {
    return {
      ok: false,
      status: 400,
      code: "bad_body",
      message: "questionType은 객관식/주관식",
    };
  }

  const [unit] = await db
    .select()
    .from(units)
    .where(eq(units.code, unitCode))
    .limit(1);
  if (!unit) {
    return { ok: false, status: 404, code: "not_found", message: "단원 없음" };
  }

  let topicLabel: string | undefined;
  if (topicCode) {
    const [topic] = await db
      .select()
      .from(topics)
      .where(eq(topics.code, topicCode))
      .limit(1);
    if (!topic || topic.unitCode !== unitCode) {
      return {
        ok: false,
        status: 400,
        code: "bad_body",
        message: "topic이 단원에 속하지 않음",
      };
    }
    topicLabel = topic.label;
  }

  return {
    ok: true,
    count,
    topicTopics:
      topicCode && topicLabel ? [{ code: topicCode, label: topicLabel }] : [],
    cond: {
      school,
      grade,
      unitCode,
      unitLabel: unit.label,
      topicCode,
      topicLabel,
      difficulty,
      questionType,
    },
  };
}

adminRoutes.post("/generate", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "bad_body", "JSON 본문 필요");
  }

  const parsed = await parseGenerateBody(body);
  if (!parsed.ok) {
    return fail(c, parsed.status, parsed.code, parsed.message);
  }

  const { cond, count, topicTopics } = parsed;
  const refs = await sampleRefs(cond);
  const created = [];

  for (let i = 0; i < count; i++) {
    let payload;
    try {
      payload = await generateFromConditions(cond, refs, {
        index: i,
        total: count,
        signal: c.req.raw.signal,
      });
    } catch (err) {
      const message =
        err instanceof LlmError
          ? err.message
          : err instanceof Error
            ? err.message
            : "조건 기반 생성 실패";
      return fail(c, 502, "generate_failed", message);
    }

    const genId = newGeneratedId();
    const [inserted] = await db
      .insert(generatedProblems)
      .values({
        id: genId,
        sourceProblemId: null,
        school: cond.school,
        grade: cond.grade,
        unitCode: cond.unitCode,
        difficulty: cond.difficulty,
        questionType: cond.questionType,
        semester: "공통",
        stem: payload.stem,
        choices: payload.choices,
        answer: payload.answer,
        explanation: payload.explanation,
        stemImagePath: null,
        origin: "admin",
        ownerId: null,
        model: payload.model,
      })
      .returning();

    created.push(
      toGeneratedDetail(inserted!, cond.unitLabel, topicTopics),
    );
  }

  return c.json({ items: created }, 201);
});

adminRoutes.post("/generate/stream", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "bad_body", "JSON 본문 필요");
  }

  const parsed = await parseGenerateBody(body);
  if (!parsed.ok) {
    return fail(c, parsed.status, parsed.code, parsed.message);
  }

  const { cond, count, topicTopics } = parsed;
  const signal = c.req.raw.signal;

  return sseResponse(c, async (stream) => {
    await writeProgress(stream, { type: "stage", stage: "refs" });
    const refs = await sampleRefs(cond);
    let saved = 0;

    for (let i = 0; i < count; i++) {
      if (signal.aborted) break;

      let payload;
      try {
        payload = await generateFromConditions(cond, refs, {
          index: i,
          total: count,
          signal,
          onProgress: (ev) => writeProgress(stream, ev),
        });
      } catch (err) {
        const message =
          err instanceof LlmError
            ? err.message
            : err instanceof Error
              ? err.message
              : "조건 기반 생성 실패";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message }),
        });
        return;
      }

      await writeProgress(stream, {
        type: "stage",
        stage: "save",
        index: i,
        total: count,
      });

      const genId = newGeneratedId();
      const [inserted] = await db
        .insert(generatedProblems)
        .values({
          id: genId,
          sourceProblemId: null,
          school: cond.school,
          grade: cond.grade,
          unitCode: cond.unitCode,
          difficulty: cond.difficulty,
          questionType: cond.questionType,
          semester: "공통",
          stem: payload.stem,
          choices: payload.choices,
          answer: payload.answer,
          explanation: payload.explanation,
          stemImagePath: null,
          origin: "admin",
          ownerId: null,
          model: payload.model,
        })
        .returning();

      const problem = toGeneratedDetail(
        inserted!,
        cond.unitLabel,
        topicTopics,
      );
      saved += 1;
      await stream.writeSSE({
        event: "item",
        data: JSON.stringify({ problem }),
      });
    }

    await stream.writeSSE({
      event: "done",
      data: JSON.stringify({ count: saved }),
    });
  });
});

adminRoutes.get("/generated", async (c) => {
  const page = parsePagination(c.req.query("limit"), c.req.query("offset"));
  if ("error" in page) return fail(c, 400, "bad_pagination", page.error);

  const where = eq(generatedProblems.origin, "admin");

  const [countRow, rows] = await Promise.all([
    db.select({ total: count() }).from(generatedProblems).where(where),
    db
      .select({
        id: generatedProblems.id,
        stem: generatedProblems.stem,
        school: generatedProblems.school,
        grade: generatedProblems.grade,
        unitCode: generatedProblems.unitCode,
        difficulty: generatedProblems.difficulty,
        questionType: generatedProblems.questionType,
        model: generatedProblems.model,
        createdAt: generatedProblems.createdAt,
        unitLabel: units.label,
      })
      .from(generatedProblems)
      .leftJoin(units, eq(units.code, generatedProblems.unitCode))
      .where(where)
      .orderBy(desc(generatedProblems.createdAt))
      .limit(page.limit)
      .offset(page.offset),
  ]);

  return c.json({
    total: countRow[0]?.total ?? 0,
    limit: page.limit,
    offset: page.offset,
    items: rows.map((r) => ({
      id: r.id,
      preview: r.stem.slice(0, 120),
      school: r.school,
      grade: r.grade,
      unitCode: r.unitCode,
      unitLabel: r.unitLabel ?? r.unitCode,
      difficulty: r.difficulty,
      questionType: r.questionType,
      model: r.model,
      createdAt: r.createdAt.toISOString(),
      origin: "admin" as const,
      generated: true as const,
    })),
  });
});
