import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  generatedProblems,
  type GeneratedChoiceRow,
  units,
} from "../db/schema.ts";
import { assetUrl } from "./content.ts";
import { MARKERS } from "./generate.ts";

export function newGeneratedId(): string {
  return `gen_${randomBytes(8).toString("hex")}`;
}

export function toGeneratedDetail(
  row: typeof generatedProblems.$inferSelect,
  unitLabel: string,
  topics: Array<{ code: string; label: string }> = [],
) {
  const choices = row.choices
    ? row.choices.map((c: GeneratedChoiceRow, i: number) => ({
        marker: MARKERS[i] ?? String(i + 1),
        text: c.text,
        isAnswer: c.isAnswer,
      }))
    : null;

  const images =
    row.stemImagePath && row.sourceProblemId
      ? [assetUrl(row.sourceProblemId, row.stemImagePath)]
      : [];

  return {
    id: row.id,
    school: row.school,
    grade: row.grade,
    subject: "수학",
    questionType: row.questionType,
    semester: row.semester,
    difficulty: row.difficulty,
    unitCode: row.unitCode,
    unitLabel,
    topics,
    publisher: row.origin === "admin" ? "AI 생성 (관리자)" : "AI 생성",
    sourcedAt: row.createdAt.toISOString().slice(0, 10),
    publicationYear: "",
    revisionYear: "",
    sourceProblemId: row.sourceProblemId ?? undefined,
    generated: true as const,
    origin: row.origin,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    content: {
      stem: { texts: [row.stem], images },
      choices,
      answer: { texts: [row.answer] },
      explanation: { texts: [row.explanation] },
    },
  };
}

export async function loadGeneratedDetail(id: string) {
  const [row] = await db
    .select({
      problem: generatedProblems,
      unitLabel: units.label,
    })
    .from(generatedProblems)
    .leftJoin(units, eq(units.code, generatedProblems.unitCode))
    .where(eq(generatedProblems.id, id))
    .limit(1);

  if (!row) return null;
  return toGeneratedDetail(
    row.problem,
    row.unitLabel ?? row.problem.unitCode,
  );
}
