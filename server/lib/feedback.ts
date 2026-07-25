import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { answerFeedbackCache } from "../db/schema.ts";
import {
  generateAnswerFeedback,
  type AnswerFeedback,
  type ExplanationSource,
  type GenerateProgress,
} from "./generate.ts";

export function feedbackAnswerKey(input: {
  correct: boolean;
  choiceMarker?: string;
  userAnswer: string;
}): string {
  if (input.choiceMarker?.trim()) {
    return `mc:${input.choiceMarker.trim()}`;
  }
  if (input.correct) return "sa:__correct__";
  const normalized = input.userAnswer.trim().replace(/\s+/g, " ").slice(0, 200);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `sa:${hash}`;
}

export async function getCachedFeedback(
  problemId: string,
  answerKey: string,
): Promise<AnswerFeedback | null> {
  const [row] = await db
    .select()
    .from(answerFeedbackCache)
    .where(
      and(
        eq(answerFeedbackCache.problemId, problemId),
        eq(answerFeedbackCache.answerKey, answerKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { guess: row.guess, tip: row.tip, model: row.model };
}

export async function putCachedFeedback(
  problemId: string,
  answerKey: string,
  feedback: AnswerFeedback,
): Promise<void> {
  await db
    .insert(answerFeedbackCache)
    .values({
      problemId,
      answerKey,
      guess: feedback.guess,
      tip: feedback.tip,
      model: feedback.model,
    })
    .onConflictDoUpdate({
      target: [
        answerFeedbackCache.problemId,
        answerFeedbackCache.answerKey,
      ],
      set: {
        guess: feedback.guess,
        tip: feedback.tip,
        model: feedback.model,
      },
    });
}

export async function getOrCreateFeedback(input: {
  problemId: string;
  source: ExplanationSource;
  correct: boolean;
  userAnswer: string;
  choiceMarker?: string;
  signal?: AbortSignal;
  onProgress?: GenerateProgress;
}): Promise<AnswerFeedback & { cached: boolean }> {
  const answerKey = feedbackAnswerKey(input);
  const cached = await getCachedFeedback(input.problemId, answerKey);
  if (cached) return { ...cached, cached: true };

  const feedback = await generateAnswerFeedback(
    {
      source: input.source,
      correct: input.correct,
      userAnswer: input.userAnswer,
      choiceMarker: input.choiceMarker,
    },
    { signal: input.signal, onProgress: input.onProgress },
  );
  await input.onProgress?.({ type: "stage", stage: "save" });
  await putCachedFeedback(input.problemId, answerKey, feedback);
  return { ...feedback, cached: false };
}
