import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  generatedExplanations,
  generatedProblems,
  problemCrops,
  problems,
  units,
} from "../db/schema.ts";
import { buildContent } from "./content.ts";
import type { ExplanationSource } from "./generate.ts";
import { loadGeneratedDetail } from "./generated.ts";
import type { AuthUser } from "./auth.ts";

export function newExplanationId(): string {
  return `exp_${randomBytes(8).toString("hex")}`;
}

export type ExplanationDto = {
  id: string;
  problemId: string;
  slot: number;
  methodLabel: string;
  body: string;
  model: string;
  createdAt: string;
};

export function toExplanationDto(
  row: typeof generatedExplanations.$inferSelect,
): ExplanationDto {
  return {
    id: row.id,
    problemId: row.problemId,
    slot: row.slot,
    methodLabel: row.methodLabel,
    body: row.body,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 유저 사유 문제면 소유자/admin만 */
export async function assertProblemReadable(
  id: string,
  user: AuthUser | null | undefined,
): Promise<
  | { ok: true }
  | { ok: false; status: 403 | 404; code: string; message: string }
> {
  if (id.startsWith("gen_")) {
    const [row] = await db
      .select({
        origin: generatedProblems.origin,
        ownerId: generatedProblems.ownerId,
      })
      .from(generatedProblems)
      .where(eq(generatedProblems.id, id))
      .limit(1);

    if (!row) {
      return {
        ok: false,
        status: 404,
        code: "not_found",
        message: "문제 없음",
      };
    }

    if (row.origin === "user") {
      if (!user || (user.role !== "admin" && user.id !== row.ownerId)) {
        return {
          ok: false,
          status: 403,
          code: "forbidden",
          message: "이 문제에 접근할 수 없어요",
        };
      }
    }
    return { ok: true };
  }

  const [row] = await db
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.id, id))
    .limit(1);

  if (!row) {
    return { ok: false, status: 404, code: "not_found", message: "문제 없음" };
  }
  return { ok: true };
}

export async function loadExplanationSource(
  id: string,
): Promise<ExplanationSource | null> {
  if (id.startsWith("gen_")) {
    const detail = await loadGeneratedDetail(id);
    if (!detail) return null;
    const choices = detail.content.choices;
    return {
      id: detail.id,
      school: detail.school,
      grade: detail.grade,
      difficulty: detail.difficulty,
      questionType: detail.questionType,
      unitCode: detail.unitCode,
      unitLabel: detail.unitLabel,
      stem: detail.content.stem.texts.join("\n"),
      choicesText: choices
        ? choices.map((c) => `${c.marker} ${c.text}`).join("\n")
        : null,
      answer: detail.content.answer.texts.join("\n"),
      explanation: detail.content.explanation.texts.join("\n") || null,
    };
  }

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

  const cropRows = await db
    .select({
      slug: problemCrops.slug,
      cropIndex: problemCrops.cropIndex,
      path: problemCrops.path,
      body: problemCrops.body,
    })
    .from(problemCrops)
    .where(eq(problemCrops.problemId, id));

  const content = buildContent(
    row.problem.id,
    row.problem.questionType,
    cropRows,
  );
  const choices = content.choices;

  return {
    id: row.problem.id,
    school: row.problem.school,
    grade: row.problem.grade,
    difficulty: row.problem.difficulty,
    questionType: row.problem.questionType,
    unitCode: row.problem.unitCode,
    unitLabel: row.unitLabel,
    stem: content.stem.texts.join("\n"),
    choicesText: choices
      ? choices.map((c) => `${c.marker} ${c.text}`).join("\n")
      : null,
    answer: content.answer.texts.join("\n") || "(정답 텍스트 없음)",
    explanation: content.explanation.texts.join("\n") || null,
  };
}

export async function listExplanations(
  problemId: string,
): Promise<ExplanationDto[]> {
  const rows = await db
    .select()
    .from(generatedExplanations)
    .where(eq(generatedExplanations.problemId, problemId))
    .orderBy(asc(generatedExplanations.slot));
  return rows.map(toExplanationDto);
}

export async function replaceExplanations(
  problemId: string,
  pair: [
    { method: string; body: string; model: string },
    { method: string; body: string; model: string },
  ],
): Promise<ExplanationDto[]> {
  await db
    .delete(generatedExplanations)
    .where(eq(generatedExplanations.problemId, problemId));

  const inserted = await db
    .insert(generatedExplanations)
    .values([
      {
        id: newExplanationId(),
        problemId,
        slot: 1,
        methodLabel: pair[0].method,
        body: pair[0].body,
        model: pair[0].model,
      },
      {
        id: newExplanationId(),
        problemId,
        slot: 2,
        methodLabel: pair[1].method,
        body: pair[1].body,
        model: pair[1].model,
      },
    ])
    .returning();

  return inserted
    .sort((a, b) => a.slot - b.slot)
    .map(toExplanationDto);
}
