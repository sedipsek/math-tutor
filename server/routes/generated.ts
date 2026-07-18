import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { and, asc, count, desc, eq } from "drizzle-orm";
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
  type AuthUser,
  type AuthVariables,
} from "../lib/auth.ts";
import { buildContent } from "../lib/content.ts";
import {
  generateSimilarProblem,
  type GenerateProgress,
  type SourceContext,
} from "../lib/generate.ts";
import {
  loadGeneratedDetail,
  newGeneratedId,
  toGeneratedDetail,
} from "../lib/generated.ts";
import { LlmError } from "../lib/llm.ts";
import { fail } from "../lib/http.ts";
import { sseResponse, writeProgress } from "../lib/sse.ts";

export const generatedRoutes = new Hono<{ Variables: AuthVariables }>();

const PROBLEMS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../datasets/aihub-secondary/problems",
);

export async function loadSourceContext(
  id: string,
): Promise<SourceContext | null> {
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

type SimilarFail = {
  ok: false;
  status: 404 | 502 | 503;
  code: string;
  message: string;
};

async function prepareSimilarSource(
  id: string,
): Promise<{ ok: true; source: SourceContext } | SimilarFail> {
  const source = await loadSourceContext(id);
  if (!source) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "원본 문제 없음",
    };
  }

  if (source.hasStemImage) {
    return {
      ok: false,
      status: 503,
      code: "vision_unavailable",
      message:
        "도형·그래프가 있는 문제는 지금은 비슷한 문제를 만들 수 없어요. 이미지를 이해하는 모델이 준비되지 않았어요.",
    };
  }

  return { ok: true, source };
}

async function saveSimilarProblem(
  source: SourceContext,
  user: AuthUser,
  payload: Awaited<ReturnType<typeof generateSimilarProblem>>,
) {
  const genId = newGeneratedId();
  const [inserted] = await db
    .insert(generatedProblems)
    .values({
      id: genId,
      sourceProblemId: source.id,
      school: source.school,
      grade: source.grade,
      unitCode: source.unitCode,
      difficulty: source.difficulty as "상" | "중" | "하",
      questionType: source.questionType,
      semester: (source.semester as "1학기" | "2학기" | "공통") || "공통",
      stem: payload.stem,
      choices: payload.choices,
      answer: payload.answer,
      explanation: payload.explanation,
      stemImagePath: payload.stemImagePath,
      origin: "user",
      ownerId: user.id,
      model: payload.model,
    })
    .returning();

  return toGeneratedDetail(inserted!, source.unitLabel, source.topics);
}

/** POST /api/problems/:id/similar — problems 라우트에서 재export용 */
export async function createSimilarHandler(
  id: string,
  user: AuthUser,
  options: {
    onProgress?: GenerateProgress;
    signal?: AbortSignal;
  } = {},
): Promise<
  | { ok: true; detail: ReturnType<typeof toGeneratedDetail> }
  | SimilarFail
> {
  const prepared = await prepareSimilarSource(id);
  if (!prepared.ok) return prepared;

  let payload;
  try {
    payload = await generateSimilarProblem(prepared.source, options);
  } catch (err) {
    const message =
      err instanceof LlmError
        ? err.message
        : err instanceof Error
          ? err.message
          : "유사 문제 생성 실패";
    return {
      ok: false,
      status: 502,
      code: "generate_failed",
      message,
    };
  }

  options.onProgress?.({ type: "stage", stage: "save" });
  const detail = await saveSimilarProblem(prepared.source, user, payload);
  return { ok: true, detail };
}

/** POST /api/problems/:id/similar/stream */
export function createSimilarStreamResponse(
  c: Context<{ Variables: AuthVariables }>,
  id: string,
  user: AuthUser,
) {
  return sseResponse(c, async (stream) => {
    const prepared = await prepareSimilarSource(id);
    if (!prepared.ok) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: prepared.message }),
      });
      return;
    }

    const signal = c.req.raw.signal;
    let payload;
    try {
      payload = await generateSimilarProblem(prepared.source, {
        signal,
        onProgress: (ev) => writeProgress(stream, ev),
      });
    } catch (err) {
      const message =
        err instanceof LlmError
          ? err.message
          : err instanceof Error
            ? err.message
            : "유사 문제 생성 실패";
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message }),
      });
      return;
    }

    await writeProgress(stream, { type: "stage", stage: "save" });
    const problem = await saveSimilarProblem(prepared.source, user, payload);
    await stream.writeSSE({
      event: "item",
      data: JSON.stringify({ problem }),
    });
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify({ count: 1 }),
    });
  });
}

generatedRoutes.get("/", async (c) => {
  const source = c.req.query("source")?.trim();
  if (!source) {
    return fail(c, 400, "bad_query", "source 쿼리 필요");
  }

  const user = c.get("user");
  if (!user) {
    return c.json({ total: 0, items: [] });
  }

  const where = and(
    eq(generatedProblems.sourceProblemId, source),
    eq(generatedProblems.ownerId, user.id),
    eq(generatedProblems.origin, "user"),
  );

  const rows = await db
    .select({
      id: generatedProblems.id,
      stem: generatedProblems.stem,
      difficulty: generatedProblems.difficulty,
      questionType: generatedProblems.questionType,
      model: generatedProblems.model,
      createdAt: generatedProblems.createdAt,
    })
    .from(generatedProblems)
    .where(where)
    .orderBy(desc(generatedProblems.createdAt));

  const [countRow] = await db
    .select({ total: count() })
    .from(generatedProblems)
    .where(where);

  return c.json({
    total: countRow?.total ?? rows.length,
    items: rows.map((r) => ({
      id: r.id,
      preview: r.stem.slice(0, 120),
      difficulty: r.difficulty,
      questionType: r.questionType,
      model: r.model,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

generatedRoutes.get("/:id", async (c) => {
  const detail = await loadGeneratedDetail(c.req.param("id"));
  if (!detail) return fail(c, 404, "not_found", "생성 문제 없음");

  // 유저 생성 문제는 본인만 (admin은 전부)
  const [row] = await db
    .select({
      origin: generatedProblems.origin,
      ownerId: generatedProblems.ownerId,
    })
    .from(generatedProblems)
    .where(eq(generatedProblems.id, c.req.param("id")))
    .limit(1);

  if (row?.origin === "user") {
    const user = c.get("user");
    if (!user || (user.role !== "admin" && user.id !== row.ownerId)) {
      return fail(c, 403, "forbidden", "이 문제에 접근할 수 없어요");
    }
  }

  return c.json(detail);
});

generatedRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!id) return fail(c, 400, "bad_path", "id 필요");
  const user = c.get("user")!;

  const [row] = await db
    .select({
      id: generatedProblems.id,
      origin: generatedProblems.origin,
      ownerId: generatedProblems.ownerId,
    })
    .from(generatedProblems)
    .where(eq(generatedProblems.id, id))
    .limit(1);

  if (!row) {
    return fail(c, 404, "not_found", "생성 문제 없음");
  }

  const allowed =
    user.role === "admin" ||
    (row.origin === "user" && row.ownerId === user.id);
  if (!allowed) {
    return fail(c, 403, "forbidden", "삭제 권한이 없어요");
  }

  await db
    .delete(generatedProblems)
    .where(eq(generatedProblems.id, id));
  return c.json({ ok: true, id });
});
