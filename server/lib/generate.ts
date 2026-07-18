/**
 * 원본 → 텍스트/이미지 분류 후 유사 문제 생성.
 * - 텍스트: glm5.2
 * - 이미지: kimiK2.7 (비전) + 원본 stem_image 유지
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProblemContent } from "./content.ts";
import { curriculumRuleLines } from "./curriculum.ts";
import {
  chatCompletion,
  chatCompletionStream,
  LlmError,
  type ChatMessage,
  type ContentPart,
} from "./llm.ts";

export type GenerateStage = "refs" | "llm" | "validate" | "save" | "retry";

export type GenerateProgressEvent =
  | {
      type: "stage";
      stage: GenerateStage;
      index?: number;
      total?: number;
      attempt?: number;
    }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string };

export type GenerateProgress = (
  event: GenerateProgressEvent,
) => void | Promise<void>;

export type GenerateOptions = {
  onProgress?: GenerateProgress;
  signal?: AbortSignal;
  index?: number;
  total?: number;
};

export type GeneratedChoice = { text: string; isAnswer: boolean };

export type GeneratedPayload = {
  stem: string;
  choices: GeneratedChoice[] | null;
  answer: string;
  explanation: string;
  model: string;
  /** 원본 문제 폴더 기준 상대경로 — 있으면 이미지를 그대로 씀 */
  stemImagePath: string | null;
};

export type SourceContext = {
  id: string;
  school: string;
  grade: string;
  subject: string;
  questionType: "객관식" | "주관식";
  difficulty: string;
  semester: string;
  unitCode: string;
  unitLabel: string;
  topics: Array<{ code: string; label: string }>;
  content: ProblemContent;
  hasStemImage: boolean;
  /** { absPath, relPath } — relPath는 원본 problems/{id}/ 기준 */
  stemImages: Array<{ absPath: string; relPath: string }>;
};

const MARKERS = [..."①②③④⑤⑥⑦⑧⑨⑩"] as const;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function formatSourceForPrompt(
  source: SourceContext,
  opts: { compact?: boolean } = {},
): string {
  const { content } = source;
  const compact = Boolean(opts.compact);
  const lines: string[] = [
    `원본 id: ${source.id}`,
    `학교급: ${source.school}`,
    `학년: ${source.grade}`,
    `유형: ${source.questionType}`,
    `난이도: ${source.difficulty}`,
    `단원: ${source.unitLabel} (${source.unitCode})`,
    `토픽: ${source.topics.map((t) => `${t.label} (${t.code})`).join(", ") || "(없음)"}`,
    `분류: ${source.hasStemImage ? "이미지 문항 (stem_image 유지)" : "텍스트 문항"}`,
    "",
    "[문항]",
    ...content.stem.texts,
  ];

  if (content.choices?.length) {
    lines.push("", "[선택지]");
    for (const c of content.choices) {
      lines.push(`${c.marker} ${c.text}${c.isAnswer ? "  ← 정답" : ""}`);
    }
  }

  // 비전 요청은 게이트웨이 ~120초 제한이 있어 해설 전문은 생략하고 정답만 짧게
  if (!compact && content.answer.texts.length) {
    lines.push("", "[정답 원문]", ...content.answer.texts);
  } else if (compact && content.answer.texts.length) {
    const short = content.answer.texts.join(" ").slice(0, 200);
    lines.push("", "[정답 힌트]", short);
  }

  if (!compact && content.explanation.texts.length) {
    lines.push("", "[해설]", ...content.explanation.texts);
  }

  return lines.join("\n");
}

function schemaHint(isMc: boolean): string {
  return isMc
    ? `{
  "stem": "문항 텍스트 (LaTeX는 $...$)",
  "choices": ["선택지1", "선택지2", "선택지3", "선택지4", "선택지5"],
  "answerIndex": 0,
  "explanation": "해설 텍스트"
}`
    : `{
  "stem": "문항 텍스트 (LaTeX는 $...$)",
  "answer": "정답 텍스트",
  "explanation": "해설 텍스트"
}`;
}

async function imageParts(
  images: SourceContext["stemImages"],
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  for (const img of images.slice(0, 3)) {
    const buf = await readFile(img.absPath);
    const ext = path.extname(img.absPath).toLowerCase();
    const mime = MIME[ext] ?? "image/png";
    parts.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
    });
  }
  return parts;
}

async function buildMessages(source: SourceContext): Promise<ChatMessage[]> {
  const isMc = source.questionType === "객관식";
  const withImage = source.hasStemImage && source.stemImages.length > 0;

  const curriculum = curriculumRuleLines(source.unitCode);
  const systemRules = withImage
    ? [
        "너는 중·고 수학 교재 문항을 만드는 출제자야.",
        "첨부된 도형/그래프 **이미지를 그대로 유지**한 채, 같은 그림을 쓰는 **유사 변형 문제**를 만든다.",
        "이미지는 학생에게 그대로 보여진다. 그림에 없는 내용을 있다고 가정하지 말고, 그림과 모순되지 않게 stem/선택지/정답/해설을 써라.",
        "문항 문구·숫자·선택지 텍스트는 바꿔도 되지만, **그림 파일은 바꾸지 않는다**.",
        ...curriculum,
        "수식은 KaTeX 호환 `$...$` / `$$...$$`로 감싼다. `\\begin{array}` 같은 환경도 반드시 `$$...$$` 안에 넣는다.",
        "응답은 JSON 객체 하나만. 코드펜스·설명문·앞뒤 잡담 금지.",
        `스키마:\n${schemaHint(isMc)}`,
        isMc
          ? "choices는 정확히 5개, answerIndex는 0~4 정수. 그림 안에 선택지가 있으면 그 내용과 맞게 적어라."
          : "주관식이므로 choices/answerIndex 필드는 넣지 않는다.",
      ]
    : [
        "너는 중·고 수학 교재 문항을 만드는 출제자야.",
        "주어진 원본 문제와 같은 성취기준·난이도·유형의 **유사 변형 문제**를 하나 만든다.",
        "숫자·식·상황을 바꿔 그대로 베끼지 말고, 같은 개념을 묻는 새 문항이어야 한다.",
        ...curriculum,
        "수식은 KaTeX 호환 `$...$` / `$$...$$`로 감싼다. `\\begin{array}` 같은 환경도 반드시 `$$...$$` 안에 넣는다.",
        "응답은 JSON 객체 하나만. 코드펜스·설명문·앞뒤 잡담 금지.",
        `스키마:\n${schemaHint(isMc)}`,
        isMc
          ? "choices는 정확히 5개, answerIndex는 0~4 정수(정답 선택지 인덱스)."
          : "주관식이므로 choices/answerIndex 필드는 넣지 않는다.",
      ];

  const system: ChatMessage = {
    role: "system",
    content: systemRules.join("\n"),
  };

  const text = withImage
    ? `첨부 그림을 유지한 채 유사 문제를 JSON으로 만들어줘.\n\n${formatSourceForPrompt(source, { compact: true })}`
    : `다음 원본을 참고해 유사 문제를 JSON으로 만들어줘.\n\n${formatSourceForPrompt(source)}`;

  if (!withImage) {
    return [system, { role: "user", content: text }];
  }

  const images = await imageParts(source.stemImages);
  return [
    system,
    {
      role: "user",
      content: [...images, { type: "text", text }],
    },
  ];
}

type RawMc = {
  stem?: unknown;
  choices?: unknown;
  answerIndex?: unknown;
  explanation?: unknown;
};

type RawSa = {
  stem?: unknown;
  answer?: unknown;
  explanation?: unknown;
};

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}가 비어 있거나 문자열이 아님`);
  }
  return value.trim();
}

function parseAndValidate(
  rawText: string,
  questionType: "객관식" | "주관식",
  model: string,
  stemImagePath: string | null,
): GeneratedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new Error("JSON 파싱 실패");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON 객체가 아님");
  }

  if (questionType === "객관식") {
    const raw = parsed as RawMc;
    const stem = asNonEmptyString(raw.stem, "stem");
    const explanation = asNonEmptyString(raw.explanation, "explanation");
    if (!Array.isArray(raw.choices) || raw.choices.length !== 5) {
      throw new Error("choices는 길이 5 배열이어야 함");
    }
    const choiceTexts = raw.choices.map((c, i) =>
      asNonEmptyString(c, `choices[${i}]`),
    );
    const answerIndex = Number(raw.answerIndex);
    if (
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex > 4
    ) {
      throw new Error("answerIndex는 0~4 정수여야 함");
    }
    return {
      stem,
      choices: choiceTexts.map((text, i) => ({
        text,
        isAnswer: i === answerIndex,
      })),
      answer: `${MARKERS[answerIndex]} ${choiceTexts[answerIndex]}`,
      explanation,
      model,
      stemImagePath,
    };
  }

  const raw = parsed as RawSa;
  return {
    stem: asNonEmptyString(raw.stem, "stem"),
    choices: null,
    answer: asNonEmptyString(raw.answer, "answer"),
    explanation: asNonEmptyString(raw.explanation, "explanation"),
    model,
    stemImagePath,
  };
}

async function withRetry(
  messages: ChatMessage[],
  mode: "text" | "vision",
  questionType: "객관식" | "주관식",
  stemImagePath: string | null,
  failLabel: string,
  options: GenerateOptions = {},
): Promise<GeneratedPayload> {
  let lastError: Error | null = null;
  const { onProgress, signal, index, total } = options;

  const emit = async (event: GenerateProgressEvent) => {
    await onProgress?.(event);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        await emit({
          type: "stage",
          stage: "retry",
          attempt: attempt + 1,
          index,
          total,
        });
      }
      await emit({
        type: "stage",
        stage: "llm",
        attempt: attempt + 1,
        index,
        total,
      });

      // SSE 쓰기가 겹치지 않도록 델타를 직렬화
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (event: GenerateProgressEvent) => {
        chain = chain.then(() => emit(event));
      };

      const { content, model } = await chatCompletionStream(messages, {
        mode,
        signal,
        onDelta: (text) => enqueue({ type: "delta", text }),
        onReasoning: (text) => enqueue({ type: "reasoning", text }),
      });
      await chain;

      await emit({
        type: "stage",
        stage: "validate",
        index,
        total,
      });
      return parseAndValidate(content, questionType, model, stemImagePath);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (signal?.aborted) throw lastError;
      const retryable =
        (err instanceof LlmError &&
          (err.status === 429 || err.status === 504)) ||
        (err instanceof Error &&
          /JSON 파싱|choices는|answerIndex|비어|aborted/i.test(err.message));
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(failLabel);
}

/** 실패 시 1회 재시도 */
export async function generateSimilarProblem(
  source: SourceContext,
  options: GenerateOptions = {},
): Promise<GeneratedPayload> {
  const withImage = source.hasStemImage && source.stemImages.length > 0;
  const mode = withImage ? ("vision" as const) : ("text" as const);
  const stemImagePath = withImage ? source.stemImages[0]!.relPath : null;
  const messages = await buildMessages(source);
  return withRetry(
    messages,
    mode,
    source.questionType,
    stemImagePath,
    "유사 문제 생성 실패",
    options,
  );
}

export type ConditionSpec = {
  school: string;
  grade: string;
  unitCode: string;
  unitLabel: string;
  topicCode?: string;
  topicLabel?: string;
  difficulty: "상" | "중" | "하";
  questionType: "객관식" | "주관식";
};

/** 조건 + few-shot 참조로 새 문항 생성 (텍스트 전용, 이미지 없음) */
export async function generateFromConditions(
  cond: ConditionSpec,
  refs: SourceContext[],
  options: GenerateOptions = {},
): Promise<GeneratedPayload> {
  const isMc = cond.questionType === "객관식";
  const topicLine =
    cond.topicCode && cond.topicLabel
      ? `${cond.topicLabel} (${cond.topicCode})`
      : "(단원 내 자유)";

  const system: ChatMessage = {
    role: "system",
    content: [
      "너는 중·고 수학 교재 문항을 만드는 출제자야.",
      "주어진 학교급·학년·단원·난이도·유형에 맞는 **새 문제**를 하나 만든다.",
      "아래 참고 문항은 스타일·개념 힌트일 뿐, 그대로 베끼지 마라. 숫자·식·상황을 새로 구성해라.",
      ...curriculumRuleLines(cond.unitCode),
      "수식은 KaTeX 호환 `$...$` / `$$...$$`로 감싼다. `\\begin{array}` 같은 환경도 반드시 `$$...$$` 안에 넣는다.",
      "이미지·도형은 쓰지 않는다. 텍스트만으로 풀 수 있는 문항이어야 한다.",
      "응답은 JSON 객체 하나만. 코드펜스·설명문·앞뒤 잡담 금지.",
      `스키마:\n${schemaHint(isMc)}`,
      isMc
        ? "choices는 정확히 5개, answerIndex는 0~4 정수(정답 선택지 인덱스)."
        : "주관식이므로 choices/answerIndex 필드는 넣지 않는다.",
    ].join("\n"),
  };

  const refBlocks = refs.map((ref, i) => {
    const body = formatSourceForPrompt(ref, { compact: true });
    return `--- 참고 ${i + 1} ---\n${body}`;
  });

  const userText = [
    "[출제 조건]",
    `학교급: ${cond.school}`,
    `학년: ${cond.grade}`,
    `단원: ${cond.unitLabel} (${cond.unitCode})`,
    `토픽: ${topicLine}`,
    `난이도: ${cond.difficulty}`,
    `유형: ${cond.questionType}`,
    "",
    ...(refBlocks.length
      ? ["[참고 문항]", ...refBlocks, ""]
      : ["(참고 문항 없음 — 조건만으로 출제)", ""]),
    "위 조건에 맞는 새 문제를 JSON으로 만들어줘.",
  ].join("\n");

  return withRetry(
    [system, { role: "user", content: userText }],
    "text",
    cond.questionType,
    null,
    "조건 기반 문제 생성 실패",
    options,
  );
}

export type ExplanationSource = {
  id: string;
  school: string;
  grade: string;
  difficulty: string;
  questionType: string;
  unitCode: string;
  unitLabel: string;
  stem: string;
  choicesText: string | null;
  answer: string;
  explanation: string | null;
};

export type AlternateExplanation = {
  method: string;
  body: string;
  model: string;
};

function parseAlternateExplanations(
  rawText: string,
  model: string,
): [AlternateExplanation, AlternateExplanation] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new Error("JSON 파싱 실패");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON 객체가 아님");
  }
  const list = (parsed as { explanations?: unknown }).explanations;
  if (!Array.isArray(list) || list.length !== 2) {
    throw new Error("explanations는 길이 2 배열이어야 함");
  }

  const out: AlternateExplanation[] = [];
  for (let i = 0; i < 2; i++) {
    const item = list[i];
    if (!item || typeof item !== "object") {
      throw new Error(`explanations[${i}]가 객체가 아님`);
    }
    const row = item as { method?: unknown; body?: unknown };
    out.push({
      method: asNonEmptyString(row.method, `explanations[${i}].method`),
      body: asNonEmptyString(row.body, `explanations[${i}].body`),
      model,
    });
  }

  if (out[0]!.method === out[1]!.method) {
    throw new Error("두 풀이 방법 이름이 같음");
  }
  if (out[0]!.body === out[1]!.body) {
    throw new Error("두 풀이 본문이 같음");
  }

  return [out[0]!, out[1]!];
}

async function streamJsonWithRetry<T>(
  messages: ChatMessage[],
  parse: (content: string, model: string) => T,
  failLabel: string,
  options: GenerateOptions = {},
): Promise<T> {
  let lastError: Error | null = null;
  const { onProgress, signal, index, total } = options;

  const emit = async (event: GenerateProgressEvent) => {
    await onProgress?.(event);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        await emit({
          type: "stage",
          stage: "retry",
          attempt: attempt + 1,
          index,
          total,
        });
      }
      await emit({
        type: "stage",
        stage: "llm",
        attempt: attempt + 1,
        index,
        total,
      });

      let chain: Promise<void> = Promise.resolve();
      const enqueue = (event: GenerateProgressEvent) => {
        chain = chain.then(() => emit(event));
      };

      const { content, model } = await chatCompletionStream(messages, {
        mode: "text",
        signal,
        onDelta: (text) => enqueue({ type: "delta", text }),
        onReasoning: (text) => enqueue({ type: "reasoning", text }),
      });
      await chain;

      await emit({ type: "stage", stage: "validate", index, total });
      return parse(content, model);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (signal?.aborted) throw lastError;
      const retryable =
        (err instanceof LlmError &&
          (err.status === 429 || err.status === 504)) ||
        (err instanceof Error &&
          /JSON 파싱|explanations|비어|같음|aborted/i.test(err.message));
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(failLabel);
}

/** 원본 해설과 다른 풀이 방법 2개 생성 (텍스트 전용) */
export async function generateAlternateExplanations(
  source: ExplanationSource,
  options: GenerateOptions = {},
): Promise<[AlternateExplanation, AlternateExplanation]> {
  const system: ChatMessage = {
    role: "system",
    content: [
      "너는 중·고 수학 해설을 쓰는 선생님이야.",
      "주어진 문항에 대해 **서로 다른 풀이 전략**의 해설을 정확히 2개 만든다.",
      "두 해설은 접근 방식이 달라야 한다 (예: 식 변형 vs 경우 나누기, 공식 vs 그래프 관찰 등).",
      "원본 해설이 있으면 베끼거나 말만 바꾼 복제를 하지 마라.",
      "학교급·학년에 맞는 용어와 난이도로 쓰고, 정답에 이르게 단계적으로 설명한다.",
      ...curriculumRuleLines(source.unitCode),
      "수식은 KaTeX 호환 `$...$` / `$$...$$`로 감싼다. `\\begin{array}` 같은 환경도 반드시 `$$...$$` 안에 넣는다.",
      "응답은 JSON 객체 하나만. 코드펜스·설명문·앞뒤 잡담 금지.",
      `스키마:
{
  "explanations": [
    { "method": "짧은 방법 이름", "body": "단계별 해설 텍스트" },
    { "method": "다른 방법 이름", "body": "단계별 해설 텍스트" }
  ]
}`,
    ].join("\n"),
  };

  const userText = [
    "[문제 정보]",
    `학교급: ${source.school}`,
    `학년: ${source.grade}`,
    `단원: ${source.unitLabel} (${source.unitCode})`,
    `난이도: ${source.difficulty}`,
    `유형: ${source.questionType}`,
    "",
    "[문항]",
    source.stem,
    "",
    ...(source.choicesText
      ? ["[선택지]", source.choicesText, ""]
      : []),
    "[정답]",
    source.answer,
    "",
    ...(source.explanation
      ? ["[원본 해설 — 참고만, 복제 금지]", source.explanation, ""]
      : ["(원본 해설 없음)", ""]),
    "위 문항의 서로 다른 풀이 방법 2개를 JSON으로 만들어줘.",
  ].join("\n");

  return streamJsonWithRetry(
    [system, { role: "user", content: userText }],
    parseAlternateExplanations,
    "다른 풀이 생성 실패",
    options,
  );
}

export type AnswerFeedbackInput = {
  source: ExplanationSource;
  correct: boolean;
  userAnswer: string;
  choiceMarker?: string;
};

export type AnswerFeedback = {
  guess: string;
  tip: string;
  model: string;
};

function parseAnswerFeedback(rawText: string, model: string): AnswerFeedback {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new Error("JSON 파싱 실패");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON 객체가 아님");
  }
  const raw = parsed as { guess?: unknown; tip?: unknown };
  return {
    guess: asNonEmptyString(raw.guess, "guess"),
    tip: asNonEmptyString(raw.tip, "tip"),
    model,
  };
}

/** 유저 답에 대한 짧은 피드백 (동기) */
export async function generateAnswerFeedback(
  input: AnswerFeedbackInput,
  options: { signal?: AbortSignal } = {},
): Promise<AnswerFeedback> {
  const { source, correct, userAnswer, choiceMarker } = input;

  const system: ChatMessage = {
    role: "system",
    content: [
      "너는 중·고 수학을 가르치는 친절한 튜터야.",
      "학생의 답을 보고 짧은 피드백 JSON만 만든다.",
      "해요체로 쓰고, 전체는 2~4문장 분량으로 짧게.",
      "원본 해설을 통째로 베끼지 마라. 핵심만 짚어라.",
      ...curriculumRuleLines(source.unitCode),
      "수식은 KaTeX 호환 `$...$` / `$$...$$`로 감싼다.",
      "응답은 JSON 객체 하나만. 코드펜스·잡담 금지.",
      `스키마:
{
  "guess": "학생이 이렇게 생각했을 가능성 (오답이면 추측, 정답이면 잘한 점)",
  "tip": "이럴 때 이렇게 하세요 / 핵심 한 줄"
}`,
    ].join("\n"),
  };

  const userText = [
    "[문제 정보]",
    `학교급: ${source.school}`,
    `학년: ${source.grade}`,
    `단원: ${source.unitLabel} (${source.unitCode})`,
    `난이도: ${source.difficulty}`,
    `유형: ${source.questionType}`,
    "",
    "[문항]",
    source.stem,
    "",
    ...(source.choicesText ? ["[선택지]", source.choicesText, ""] : []),
    "[정답]",
    source.answer,
    "",
    ...(source.explanation
      ? ["[원본 해설 — 참고만]", source.explanation, ""]
      : []),
    "[학생 결과]",
    `정오: ${correct ? "정답" : "오답"}`,
    choiceMarker ? `고른 선택지: ${choiceMarker}` : "",
    `학생 답: ${userAnswer || "(없음)"}`,
    "",
    "위 정보를 바탕으로 짧은 피드백 JSON을 만들어줘.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { content, model } = await chatCompletion(
        [system, { role: "user", content: userText }],
        { mode: "text", signal: options.signal },
      );
      return parseAnswerFeedback(content, model);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (options.signal?.aborted) throw lastError;
      const retryable =
        (err instanceof LlmError &&
          (err.status === 429 || err.status === 504)) ||
        (err instanceof Error && /JSON 파싱|비어/i.test(err.message));
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("피드백 생성 실패");
}

export { MARKERS };
