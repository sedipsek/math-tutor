import { useEffect, useRef } from "react";
import type { GenerateStage } from "../api";

type Props = {
  busy: boolean;
  stage: GenerateStage | null;
  index?: number;
  total?: number;
  attempt?: number;
  draft: string;
  reasoning: string;
  /** 단계 문구 덮어쓰기 (피드백 등) */
  labels?: Partial<Record<GenerateStage, string>>;
  doneLabel?: string;
};

const STAGE_LABEL: Record<GenerateStage, string> = {
  refs: "참고 문제를 고르는 중이에요",
  llm: "AI가 문제를 쓰는 중이에요",
  validate: "응답을 검증하는 중이에요",
  save: "저장하는 중이에요",
  retry: "다시 시도하는 중이에요",
};

export default function GenerateLivePanel({
  busy,
  stage,
  index,
  total,
  attempt,
  draft,
  reasoning,
  labels,
  doneLabel = "생성이 끝났어요",
}: Props) {
  const draftRef = useRef<HTMLPreElement>(null);
  const reasoningRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = draftRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [draft]);

  useEffect(() => {
    const el = reasoningRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning]);

  if (!busy && !draft && !reasoning && !stage) return null;

  const stageLabel = stage
    ? (labels?.[stage] ?? STAGE_LABEL[stage])
    : "준비하는 중이에요";
  const progress =
    typeof index === "number" && typeof total === "number" && total > 1
      ? `${index + 1} / ${total}`
      : null;

  return (
    <div className="gen-live" aria-live="polite">
      <div className="gen-live-head">
        <span className={`gen-live-dot${busy ? " pulse" : ""}`} aria-hidden />
        <div className="gen-live-status">
          <strong>{busy ? stageLabel : doneLabel}</strong>
          <span className="dim-text">
            {progress ? `${progress}번째 문제` : null}
            {attempt && attempt > 1 ? ` · ${attempt}번째 시도` : null}
          </span>
        </div>
      </div>

      {reasoning ? (
        <details className="gen-live-reasoning" open={busy}>
          <summary>생각 중</summary>
          <pre ref={reasoningRef}>{reasoning}</pre>
        </details>
      ) : null}

      <div className="gen-live-draft">
        <div className="gen-live-draft-label">초안</div>
        <pre ref={draftRef}>
          {draft || (busy ? "토큰을 기다리는 중…" : "(비어 있음)")}
        </pre>
      </div>
    </div>
  );
}
