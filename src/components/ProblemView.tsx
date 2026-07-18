import { useEffect, useRef, useState } from "react";
import {
  deleteGenerated,
  fetchExplanations,
  fetchGenerated,
  fetchGeneratedBySource,
  requestAnswerFeedback,
  streamGenerateExplanations,
  streamGenerateSimilar,
  type GenerateStage,
} from "../api";
import { useAuth } from "../auth";
import type {
  AlternateExplanation,
  GeneratedSummary,
  ProblemDetail,
} from "../types";
import GenerateLivePanel from "./GenerateLivePanel";
import MathText from "./MathText";

type Props = {
  detail: ProblemDetail;
  /** 연습 모드: 선택지 클릭·채점 활성화 */
  interactive?: boolean;
  onJudge?: (correct: boolean) => void;
  /** 중첩된 생성 문제 뷰에서는 유사 생성 UI를 숨김 */
  nested?: boolean;
  onNeedLogin?: () => void;
};

/**
 * 문제 본문 + 선택지 + 정답/해설.
 * key={detail.id}로 마운트해서 문제가 바뀌면 상태가 초기화되게 쓴다.
 */
export default function ProblemView({
  detail,
  interactive,
  onJudge,
  nested = false,
  onNeedLogin,
}: Props) {
  const { user } = useAuth();
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [judged, setJudged] = useState<boolean | null>(null);

  const [genList, setGenList] = useState<GeneratedSummary[]>([]);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [activeGen, setActiveGen] = useState<ProblemDetail | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [liveStage, setLiveStage] = useState<GenerateStage | null>(null);
  const [liveAttempt, setLiveAttempt] = useState<number | undefined>();
  const [liveDraft, setLiveDraft] = useState("");
  const [liveReasoning, setLiveReasoning] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const [altExps, setAltExps] = useState<AlternateExplanation[]>([]);
  const [altTab, setAltTab] = useState(0);
  const [altLoading, setAltLoading] = useState(false);
  const [altBusy, setAltBusy] = useState(false);
  const [altError, setAltError] = useState("");
  const [altStage, setAltStage] = useState<GenerateStage | null>(null);
  const [altAttempt, setAltAttempt] = useState<number | undefined>();
  const [altDraft, setAltDraft] = useState("");
  const [altReasoning, setAltReasoning] = useState("");
  const altAbortRef = useRef<AbortController | null>(null);

  const [fbGuess, setFbGuess] = useState("");
  const [fbTip, setFbTip] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbError, setFbError] = useState("");
  const [saWrongAnswer, setSaWrongAnswer] = useState("");
  const [saSubmitted, setSaSubmitted] = useState(false);
  const fbAbortRef = useRef<AbortController | null>(null);

  const isGenerated = Boolean(detail.generated) || detail.id.startsWith("gen_");
  const showSimilarUi = !nested && !isGenerated;

  const { stem, choices, answer, explanation } = detail.content;
  const hasStemImage = stem.images.length > 0;
  const hasAnswerMark = choices?.some((c) => c.isAnswer) ?? false;
  const isMc = Boolean(choices && hasAnswerMark);
  const showSelfReport =
    Boolean(interactive) && judged === null && !isMc;
  const showSaWrongInput =
    Boolean(interactive) && judged === false && !isMc && !saSubmitted;

  useEffect(() => {
    if (!showSimilarUi) return;
    const controller = new AbortController();
    setListLoading(true);
    fetchGeneratedBySource(detail.id, controller.signal)
      .then((res) => setGenList(res.items))
      .catch((err) => {
        if (err.name !== "AbortError") setGenError(err.message);
      })
      .finally(() => setListLoading(false));
    return () => controller.abort();
  }, [detail.id, showSimilarUi]);

  function reveal() {
    setRevealed(true);
    if (
      interactive &&
      choices &&
      hasAnswerMark &&
      picked !== null &&
      judged === null
    ) {
      const correct =
        choices.find((c) => c.marker === picked)?.isAnswer ?? false;
      setJudged(correct);
      onJudge?.(correct);
    }
  }

  function selfReport(correct: boolean) {
    if (judged !== null) return;
    setJudged(correct);
    onJudge?.(correct);
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      altAbortRef.current?.abort();
      fbAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAltLoading(true);
    setAltError("");
    setAltExps([]);
    setAltTab(0);
    setFbGuess("");
    setFbTip("");
    setFbError("");
    setFbBusy(false);
    setSaWrongAnswer("");
    setSaSubmitted(false);
    fetchExplanations(detail.id, controller.signal)
      .then((res) => {
        setAltExps(res.items);
        setAltTab(0);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setAltError(err.message);
      })
      .finally(() => setAltLoading(false));
    return () => controller.abort();
  }, [detail.id]);

  async function loadFeedback(
    correct: boolean,
    userAnswer: string,
    choiceMarker?: string,
  ) {
    if (!user) return;
    fbAbortRef.current?.abort();
    const controller = new AbortController();
    fbAbortRef.current = controller;
    setFbBusy(true);
    setFbError("");
    setFbGuess("");
    setFbTip("");
    try {
      const res = await requestAnswerFeedback(
        detail.id,
        { correct, userAnswer, choiceMarker },
        controller.signal,
      );
      setFbGuess(res.guess);
      setFbTip(res.tip);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setFbError(err instanceof Error ? err.message : "피드백 실패");
    } finally {
      setFbBusy(false);
      if (fbAbortRef.current === controller) fbAbortRef.current = null;
    }
  }

  useEffect(() => {
    if (!interactive || judged === null || !user) return;

    if (isMc && picked) {
      const choice = choices?.find((c) => c.marker === picked);
      void loadFeedback(
        judged,
        `${picked} ${choice?.text ?? ""}`.trim(),
        picked,
      );
      return;
    }

    if (!isMc && judged === true) {
      void loadFeedback(true, "(정답)");
    }
    // 주관식 오답은 입력 제출 후에만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, judged, picked, user, detail.id, isMc]);

  function submitSaWrong(e: React.FormEvent) {
    e.preventDefault();
    const text = saWrongAnswer.trim();
    if (!text) {
      setFbError("작성한 답을 입력해 주세요");
      return;
    }
    setSaSubmitted(true);
    void loadFeedback(false, text);
  }

  async function onGenerateAlts() {
    if (!user) {
      onNeedLogin?.();
      return;
    }

    altAbortRef.current?.abort();
    const controller = new AbortController();
    altAbortRef.current = controller;

    setAltBusy(true);
    setAltError("");
    setAltStage(null);
    setAltAttempt(undefined);
    setAltDraft("");
    setAltReasoning("");
    const collected: AlternateExplanation[] = [];

    try {
      await streamGenerateExplanations(
        detail.id,
        {
          onStage: (info) => {
            if (info.stage === "retry" || info.stage === "llm") {
              setAltDraft("");
              setAltReasoning("");
            }
            setAltStage(info.stage);
            setAltAttempt(info.attempt);
          },
          onDelta: (text) => setAltDraft((prev) => prev + text),
          onReasoning: (text) => setAltReasoning((prev) => prev + text),
          onExplanation: (exp) => {
            collected.push(exp);
            setAltExps([...collected].sort((a, b) => a.slot - b.slot));
            setAltTab(0);
          },
          onError: (message) => setAltError(message),
        },
        controller.signal,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setAltError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setAltBusy(false);
      if (altAbortRef.current === controller) altAbortRef.current = null;
    }
  }

  async function onGenerate() {
    if (!user) {
      onNeedLogin?.();
      return;
    }
    if (hasStemImage) {
      setGenError(
        "도형·그래프가 있는 문제는 지금은 비슷한 문제를 만들 수 없어요. 이미지를 이해하는 모델이 준비되지 않았어요.",
      );
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenLoading(true);
    setGenError("");
    setLiveStage(null);
    setLiveAttempt(undefined);
    setLiveDraft("");
    setLiveReasoning("");

    try {
      await streamGenerateSimilar(
        detail.id,
        {
          onStage: (info) => {
            if (info.stage === "retry" || info.stage === "llm") {
              setLiveDraft("");
              setLiveReasoning("");
            }
            setLiveStage(info.stage);
            setLiveAttempt(info.attempt);
          },
          onDelta: (text) => setLiveDraft((prev) => prev + text),
          onReasoning: (text) => setLiveReasoning((prev) => prev + text),
          onItem: (created) => {
            setActiveGen(created);
            setGenList((prev) => [
              {
                id: created.id,
                preview:
                  created.content.stem.texts[0]?.slice(0, 120) ?? created.id,
                difficulty: created.difficulty,
                questionType: created.questionType,
                model: created.model ?? "",
                createdAt: created.createdAt ?? new Date().toISOString(),
              },
              ...prev.filter((g) => g.id !== created.id),
            ]);
          },
          onError: (message) => setGenError(message),
        },
        controller.signal,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setGenError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setGenLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function openGenerated(id: string) {
    setGenError("");
    try {
      const item = await fetchGenerated(id);
      setActiveGen(item);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }

  async function onDeleteGenerated(id: string) {
    setGenError("");
    try {
      await deleteGenerated(id);
      setGenList((prev) => prev.filter((g) => g.id !== id));
      if (activeGen?.id === id) setActiveGen(null);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <article className="problem-view">
      <header className="pv-head">
        {isGenerated && (
          <span className="tag gen">
            {detail.origin === "admin" ? "AI (관리자)" : "AI"}
          </span>
        )}
        <span className={`tag diff-${detail.difficulty}`}>
          난이도 {detail.difficulty}
        </span>
        <span className="tag">{detail.unitLabel}</span>
        {detail.topics.map((t) => (
          <span key={t.code} className="tag dim">
            {t.label}
          </span>
        ))}
        <span className="tag dim">{detail.semester}</span>
        <span className="tag dim">{detail.questionType}</span>
      </header>

      <div className="pv-stem">
        {stem.texts.map((text, i) => (
          <p key={i}>
            <MathText>{text}</MathText>
          </p>
        ))}
        {stem.images.map((src) => (
          <img key={src} src={src} alt="문제 도형" loading="lazy" />
        ))}
      </div>

      {choices && (
        <ol className="pv-choices">
          {choices.map((choice) => {
            const isPicked = picked === choice.marker;
            const state = !revealed
              ? isPicked
                ? "picked"
                : ""
              : choice.isAnswer && hasAnswerMark
                ? "correct"
                : isPicked
                  ? "wrong"
                  : "";
            return (
              <li key={choice.marker}>
                <button
                  className={`choice ${state}`}
                  disabled={!interactive || revealed}
                  onClick={() => setPicked(isPicked ? null : choice.marker)}
                >
                  <b>{choice.marker}</b>
                  <span>
                    {choice.text ? <MathText>{choice.text}</MathText> : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {!revealed ? (
        <button className="reveal-btn" onClick={reveal}>
          {interactive && choices && hasAnswerMark
            ? picked
              ? "채점하기"
              : "정답 · 해설 보기"
            : "정답 · 해설 보기"}
        </button>
      ) : (
        <div className="pv-solution">
          {judged !== null && (
            <p className={`verdict ${judged ? "ok" : "no"}`}>
              {judged ? "정답이에요!" : "아쉽지만 오답이에요"}
            </p>
          )}

          {showSelfReport && (
            <div className="self-report">
              <span>맞았나요?</span>
              <button className="ok" onClick={() => selfReport(true)}>
                맞았어요
              </button>
              <button className="no" onClick={() => selfReport(false)}>
                틀렸어요
              </button>
            </div>
          )}

          {showSaWrongInput && (
            <form className="sa-wrong-form" onSubmit={submitSaWrong}>
              <label htmlFor="sa-wrong-answer">
                어떤 답을 썼는지 알려 주세요
              </label>
              <textarea
                id="sa-wrong-answer"
                rows={3}
                value={saWrongAnswer}
                onChange={(e) => setSaWrongAnswer(e.target.value)}
                placeholder="내가 쓴 답을 적어 주세요"
              />
              <button type="submit" className="alt-sol-btn" disabled={fbBusy}>
                {fbBusy ? "피드백 만드는 중…" : "피드백 받기"}
              </button>
            </form>
          )}

          {interactive && judged !== null && (
            <div className="feedback-card">
              <h4>AI 피드백</h4>
              {!user ? (
                <p className="dim-text">
                  로그인하면 AI 피드백을 받을 수 있어요.{" "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onNeedLogin?.()}
                  >
                    로그인
                  </button>
                </p>
              ) : showSaWrongInput ? (
                <p className="dim-text">
                  답을 입력하고 피드백 받기를 눌러 주세요.
                </p>
              ) : fbBusy ? (
                <p className="dim-text">피드백을 준비하는 중이에요…</p>
              ) : fbError ? (
                <div className="notice error">{fbError}</div>
              ) : fbGuess || fbTip ? (
                <div className="feedback-body">
                  {fbGuess && (
                    <p>
                      <span className="feedback-label">이랬나요?</span>{" "}
                      <MathText>{fbGuess}</MathText>
                    </p>
                  )}
                  {fbTip && (
                    <p>
                      <span className="feedback-label">이럴 땐</span>{" "}
                      <MathText>{fbTip}</MathText>
                    </p>
                  )}
                </div>
              ) : (
                <p className="dim-text">피드백이 아직 없어요.</p>
              )}
            </div>
          )}

          {(!choices || !hasAnswerMark || detail.questionType === "주관식") &&
            answer.texts.length > 0 && (
              <div className="sol-block">
                <h4>정답</h4>
                {answer.texts.map((text, i) => (
                  <p key={i}>
                    <MathText>{text}</MathText>
                  </p>
                ))}
              </div>
            )}

          <div className="sol-block">
            <h4>해설</h4>
            {explanation.texts.length ? (
              explanation.texts.map((text, i) => (
                <p key={i}>
                  <MathText>{text}</MathText>
                </p>
              ))
            ) : (
              <p className="dim-text">등록된 해설이 없어요.</p>
            )}
          </div>

          <div className="sol-block alt-sol">
            <div className="alt-sol-head">
              <h4>다른 풀이</h4>
              <button
                type="button"
                className="alt-sol-btn"
                disabled={altBusy}
                onClick={() => void onGenerateAlts()}
              >
                {altBusy
                  ? "만드는 중…"
                  : !user
                    ? "로그인하고 다른 풀이 보기"
                    : altExps.length
                      ? "다시 만들기"
                      : "다른 풀이 보기"}
              </button>
            </div>

            {altLoading && (
              <p className="dim-text">다른 풀이 불러오는 중…</p>
            )}

            {(altBusy || altDraft || altReasoning || altStage) && (
              <GenerateLivePanel
                busy={altBusy}
                stage={altStage}
                attempt={altAttempt}
                draft={altDraft}
                reasoning={altReasoning}
              />
            )}

            {altError && <div className="notice error">{altError}</div>}

            {!altLoading && altExps.length > 0 && (
              <>
                <div className="alt-sol-tabs" role="tablist">
                  {altExps.map((exp, i) => (
                    <button
                      key={exp.id}
                      type="button"
                      role="tab"
                      aria-selected={altTab === i}
                      className={altTab === i ? "on" : ""}
                      onClick={() => setAltTab(i)}
                    >
                      {exp.methodLabel}
                    </button>
                  ))}
                </div>
                {altExps[altTab] && (
                  <div className="alt-sol-body" role="tabpanel">
                    <p>
                      <MathText>{altExps[altTab].body}</MathText>
                    </p>
                  </div>
                )}
              </>
            )}

            {!altLoading && !altBusy && !altExps.length && !altError && (
              <p className="dim-text">
                AI가 원본과 다른 풀이 방법 2개를 만들어 줘요.
              </p>
            )}
          </div>
        </div>
      )}

      <footer className="pv-source">
        {detail.publisher}
        {detail.publicationYear ? ` · ${detail.publicationYear.slice(0, 4)}` : ""}
        {" · "}
        {detail.id}
      </footer>

      {showSimilarUi && (
        <section className="similar-panel">
          {hasStemImage ? (
            <div className="notice">
              도형·그래프가 있는 문제는 지금은 비슷한 문제를 만들 수 없어요.
              이미지를 이해하는 모델이 준비되지 않았어요.
            </div>
          ) : (
            <div className="similar-actions">
              <button
                className="similar-btn"
                disabled={genLoading}
                onClick={() => void onGenerate()}
              >
                {genLoading
                  ? "만드는 중…"
                  : user
                    ? "비슷한 문제 만들기"
                    : "로그인하고 비슷한 문제 만들기"}
              </button>
              {genLoading && (
                <span className="dim-text">
                  아래에서 작성 과정을 볼 수 있어요.
                </span>
              )}
            </div>
          )}

          {(genLoading || liveDraft || liveReasoning || liveStage) && (
            <GenerateLivePanel
              busy={genLoading}
              stage={liveStage}
              attempt={liveAttempt}
              draft={liveDraft}
              reasoning={liveReasoning}
            />
          )}

          {genError && <div className="notice error">{genError}</div>}

          {listLoading ? (
            <p className="dim-text">유사 문제 목록 불러오는 중…</p>
          ) : genList.length > 0 ? (
            <div className="similar-list">
              <h4>이 문제로 만든 유사 문제 {genList.length}개</h4>
              <ul>
                {genList.map((g) => (
                  <li key={g.id}>
                    <button
                      className="similar-item"
                      onClick={() => void openGenerated(g.id)}
                    >
                      <span className={`tag diff-${g.difficulty}`}>
                        {g.difficulty}
                      </span>
                      <span className="similar-preview">
                        <MathText>{g.preview}</MathText>
                      </span>
                    </button>
                    <button
                      className="similar-del"
                      aria-label="삭제"
                      onClick={() => void onDeleteGenerated(g.id)}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {activeGen && (
            <div className="similar-result">
              <h4>유사 문제</h4>
              <ProblemView
                key={activeGen.id}
                detail={activeGen}
                interactive
                nested
              />
            </div>
          )}
        </section>
      )}
    </article>
  );
}
