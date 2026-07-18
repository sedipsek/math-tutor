/**
 * crop 행(원본 데이터)을 화면에서 바로 쓸 수 있는 구조화된 문항 콘텐츠로 변환.
 * DB에 저장된 정보는 그대로 두고, 표현·가공만 여기서 담당한다.
 */

export type CropRow = {
  slug: string;
  cropIndex: number;
  path: string | null;
  body: string | null;
};

export type Choice = { marker: string; text: string; isAnswer: boolean };

export type ProblemContent = {
  stem: { texts: string[]; images: string[] };
  choices: Choice[] | null;
  answer: { texts: string[] };
  explanation: { texts: string[] };
};

/** OCR이 남긴 옛한글 낱자(ᄀᄂᄃᄅ)를 호환 자모로 교정 */
const STANDALONE_JAMO: Record<string, string> = {
  "ᄀ": "ㄱ",
  "ᄂ": "ㄴ",
  "ᄃ": "ㄷ",
  "ᄅ": "ㄹ",
};

export function normalizeText(text: string): string {
  return text
    .replace(/[ᄀᄂᄃᄅ]/g, (ch) => STANDALONE_JAMO[ch] ?? ch)
    .trim();
}

/** 교재 내부 문항 번호("06 다음 …")는 표시에서 제거 */
function stripLeadingNumber(text: string): string {
  return text.replace(/^\d{1,2}\s+(?=\S)/, "");
}

export function assetUrl(problemId: string, relPath: string): string {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `/api/problems/${encodeURIComponent(problemId)}/assets/${encoded}`;
}

const MARKERS = [..."①②③④⑤⑥⑦⑧⑨⑩"];
const MARKER_RE = /([①②③④⑤⑥⑦⑧⑨⑩])\s*/g;
const MATH_CHUNK = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;

/** 번호 없는 선택지 텍스트를 줄바꿈·연속 수식 단위로 나눔 */
function splitUnmarked(text: string): string[] {
  const bodies: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const chunks = [...trimmed.matchAll(MATH_CHUNK)];
    if (chunks.length >= 2 && trimmed.replace(MATH_CHUNK, "").trim() === "") {
      bodies.push(...chunks.map((m) => m[0]));
      continue;
    }
    bodies.push(trimmed);
  }
  return bodies;
}

/**
 * 객관식 정답/오답 텍스트에서 ①~⑩ 선택지를 복원.
 * 정답 crop에서 나온 조각은 isAnswer로 표시된다.
 */
export function parseChoices(
  answerTexts: string[],
  wrongTexts: string[],
): Choice[] | null {
  type Seg = { order: number; text: string; fromAnswer: boolean };
  const segments: Seg[] = [];
  const unmarked: Array<{ text: string; fromAnswer: boolean }> = [];

  const scan = (texts: string[], fromAnswer: boolean) => {
    for (const text of texts) {
      const marks = [...text.matchAll(MARKER_RE)];
      if (marks.length === 0) {
        unmarked.push(
          ...splitUnmarked(text).map((t) => ({ text: t, fromAnswer })),
        );
        continue;
      }
      marks.forEach((mark, i) => {
        const start = (mark.index ?? 0) + mark[0].length;
        const end =
          i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length;
        segments.push({
          order: MARKERS.indexOf(mark[1]),
          text: text.slice(start, end).trim(),
          fromAnswer,
        });
      });
    }
  };

  scan(answerTexts, true);
  scan(wrongTexts, false);

  const byOrder = new Map<number, Seg>();
  for (const seg of segments) {
    const prev = byOrder.get(seg.order);
    if (!prev) {
      byOrder.set(seg.order, { ...seg });
    } else {
      if (!prev.text && seg.text) prev.text = seg.text;
      if (seg.fromAnswer) prev.fromAnswer = true;
    }
  }

  // OCR이 번호를 빼먹은 조각은 비어 있는 ①~⑤ 자리에 순서대로 채움
  let next = 0;
  for (let order = 0; order < 5 && next < unmarked.length; order++) {
    if (byOrder.has(order)) continue;
    const u = unmarked[next++];
    byOrder.set(order, { order, text: u.text, fromAnswer: u.fromAnswer });
  }

  const list = [...byOrder.values()].sort((a, b) => a.order - b.order);
  if (list.length < 2) return null;
  return list.map((seg) => ({
    marker: MARKERS[seg.order] ?? "?",
    text: seg.text,
    isAnswer: seg.fromAnswer,
  }));
}

export function buildContent(
  problemId: string,
  questionType: string,
  crops: CropRow[],
): ProblemContent {
  const bodies = (prefix: string) =>
    crops
      .filter((c) => c.slug.startsWith(prefix) && c.body)
      .sort(
        (a, b) => a.slug.localeCompare(b.slug) || a.cropIndex - b.cropIndex,
      )
      .map((c) => normalizeText(c.body!))
      .filter(Boolean);

  const stemTexts = bodies("stem_text").map(stripLeadingNumber);
  const stemImages = crops
    .filter((c) => c.slug === "stem_image" && c.path)
    .sort((a, b) => a.cropIndex - b.cropIndex)
    .map((c) => assetUrl(problemId, c.path!));

  const answerTexts = bodies("answer");
  const wrongTexts = bodies("wrong");
  const explanationTexts = bodies("explanation");

  return {
    stem: { texts: stemTexts, images: stemImages },
    choices:
      questionType === "객관식" ? parseChoices(answerTexts, wrongTexts) : null,
    answer: { texts: answerTexts },
    explanation: { texts: explanationTexts },
  };
}

/** 목록 카드용 미리보기 텍스트 */
export function previewText(body: string | null): string | null {
  if (!body) return null;
  const cleaned = stripLeadingNumber(normalizeText(body));
  return cleaned || null;
}
