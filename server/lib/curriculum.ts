import { TOPIC_ROWS, UNIT_ROWS } from "../db/catalog.generated.ts";

const BAND_ORDER = ["MS1", "MS2", "MS3", "HS1"] as const;

type Band = (typeof BAND_ORDER)[number];

function parseUnitCode(code: string): { band: Band; num: number } | null {
  const m = code.trim().match(/^(MS[123]|HS1)-(\d+)$/);
  if (!m) return null;
  return { band: m[1] as Band, num: Number(m[2]) };
}

function bandRank(band: Band): number {
  return BAND_ORDER.indexOf(band);
}

/** 커리큘럼 순서: MS1 → MS2 → MS3 → HS1, 밴드 안 번호 오름차순 */
export function compareUnitCodes(a: string, b: string): number {
  const pa = parseUnitCode(a);
  const pb = parseUnitCode(b);
  if (!pa && !pb) return a.localeCompare(b);
  if (!pa) return 1;
  if (!pb) return -1;
  const br = bandRank(pa.band) - bandRank(pb.band);
  if (br !== 0) return br;
  return pa.num - pb.num;
}

export type AllowedCurriculum = {
  unitCode: string;
  units: Array<{ code: string; label: string; school: string; grade: string }>;
  topics: Array<{ code: string; label: string; unitCode: string }>;
  promptBlock: string;
};

/** 해당 단원 이전 전부 + 현재 단원까지 허용 */
export function allowedThrough(unitCode: string): AllowedCurriculum {
  const pivot = parseUnitCode(unitCode);
  const units = [...UNIT_ROWS]
    .filter((u) => {
      if (!pivot) return u.code === unitCode;
      const p = parseUnitCode(u.code);
      if (!p) return false;
      const br = bandRank(p.band) - bandRank(pivot.band);
      if (br < 0) return true;
      if (br > 0) return false;
      return p.num <= pivot.num;
    })
    .sort((a, b) => compareUnitCodes(a.code, b.code));

  const allowedCodes = new Set(units.map((u) => u.code));
  const topics = TOPIC_ROWS.filter((t) => allowedCodes.has(t.unitCode));

  const unitLines = units.map(
    (u) => `- ${u.code} ${u.label} (${u.school} ${u.grade})`,
  );
  // 프롬프트 길이 제한: 토픽은 현재 단원 우선, 나머지는 코드만 압축
  const currentTopics = topics.filter((t) => t.unitCode === unitCode);
  const priorTopicCount = topics.length - currentTopics.length;
  const topicLines = [
    ...currentTopics.map((t) => `- ${t.code} ${t.label} [${t.unitCode}]`),
    ...(priorTopicCount > 0
      ? [
          `- (선행 단원 성취기준 ${priorTopicCount}개 — 위 허용 단원 범위 안의 개념만 사용)`,
        ]
      : []),
  ];

  const promptBlock = [
    "[허용 수학 지식 — 이 범위만 사용]",
    `현재 단원: ${unitCode}`,
    "해설·풀이·피드백에서 아래 허용 단원·성취기준을 넘어가는 개념·공식·용어를 쓰지 마라.",
    "더 쉬운 선행 지식은 사용해도 된다. 이후 학년·단원 내용은 금지.",
    "",
    "허용 단원:",
    ...unitLines,
    "",
    "현재 단원 성취기준(토픽):",
    ...(topicLines.length ? topicLines : ["- (토픽 없음)"]),
  ].join("\n");

  return { unitCode, units, topics, promptBlock };
}

export function curriculumRuleLines(unitCode: string): string[] {
  const { promptBlock } = allowedThrough(unitCode);
  return [
    "해설(및 풀이 과정)은 학생 학년·단원 수준을 넘지 않는다.",
    promptBlock,
  ];
}
