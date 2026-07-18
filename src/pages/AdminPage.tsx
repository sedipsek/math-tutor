import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteGenerated,
  fetchAdminGenerated,
  fetchGenerated,
  streamAdminGenerate,
  type GenerateStage,
} from "../api";
import type { GeneratedSummary, Meta, ProblemDetail } from "../types";
import GenerateLivePanel from "../components/GenerateLivePanel";
import MathText from "../components/MathText";
import ProblemView from "../components/ProblemView";

type Props = { meta: Meta };

const DIFFS = ["하", "중", "상"] as const;
const TYPES = ["객관식", "주관식"] as const;

export default function AdminPage({ meta }: Props) {
  const [school, setSchool] = useState<"중학교" | "고등학교">("중학교");
  const [grade, setGrade] = useState("1학년");
  const [unitCode, setUnitCode] = useState("");
  const [topicCode, setTopicCode] = useState("");
  const [difficulty, setDifficulty] =
    useState<(typeof DIFFS)[number]>("중");
  const [questionType, setQuestionType] =
    useState<(typeof TYPES)[number]>("객관식");
  const [count, setCount] = useState(1);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<ProblemDetail[]>([]);
  const [liveStage, setLiveStage] = useState<GenerateStage | null>(null);
  const [liveIndex, setLiveIndex] = useState<number | undefined>();
  const [liveTotal, setLiveTotal] = useState<number | undefined>();
  const [liveAttempt, setLiveAttempt] = useState<number | undefined>();
  const [liveDraft, setLiveDraft] = useState("");
  const [liveReasoning, setLiveReasoning] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const [list, setList] = useState<GeneratedSummary[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [preview, setPreview] = useState<ProblemDetail | null>(null);

  const grades = useMemo(
    () =>
      meta.grades
        .filter((g) => g.school === school)
        .map((g) => g.value),
    [meta.grades, school],
  );

  const units = useMemo(
    () =>
      meta.units.filter((u) => u.school === school && u.grade === grade),
    [meta.units, school, grade],
  );

  const topics = useMemo(
    () =>
      unitCode
        ? meta.topics.filter((t) => t.unitCode === unitCode)
        : [],
    [meta.topics, unitCode],
  );

  useEffect(() => {
    if (!grades.includes(grade) && grades[0]) setGrade(grades[0]);
  }, [grades, grade]);

  useEffect(() => {
    if (!units.some((u) => u.code === unitCode)) {
      setUnitCode(units[0]?.code ?? "");
      setTopicCode("");
    }
  }, [units, unitCode]);

  async function reloadList() {
    setListLoading(true);
    try {
      const res = await fetchAdminGenerated(30, 0);
      setList(res.items);
      setListTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록 실패");
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    void reloadList();
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!unitCode) {
      setError("단원을 선택해 주세요");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError("");
    setCreated([]);
    setLiveStage(null);
    setLiveIndex(undefined);
    setLiveTotal(count);
    setLiveAttempt(undefined);
    setLiveDraft("");
    setLiveReasoning("");

    const items: ProblemDetail[] = [];
    try {
      await streamAdminGenerate(
        {
          school,
          grade,
          unitCode,
          topicCode: topicCode || undefined,
          difficulty,
          questionType,
          count,
        },
        {
          onStage: (info) => {
            if (info.stage === "retry" || info.stage === "llm") {
              setLiveDraft("");
              setLiveReasoning("");
            }
            setLiveStage(info.stage);
            setLiveIndex(info.index);
            setLiveTotal(info.total ?? count);
            setLiveAttempt(info.attempt);
          },
          onDelta: (text) => setLiveDraft((prev) => prev + text),
          onReasoning: (text) => setLiveReasoning((prev) => prev + text),
          onItem: (problem) => {
            items.push(problem);
            setCreated([...items]);
          },
          onError: (message) => setError(message),
        },
        controller.signal,
      );
      await reloadList();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function openItem(id: string) {
    try {
      setPreview(await fetchGenerated(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteGenerated(id);
      setList((prev) => prev.filter((x) => x.id !== id));
      setListTotal((t) => Math.max(0, t - 1));
      if (preview?.id === id) setPreview(null);
      setCreated((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-head">
        <div className="admin-icon" aria-hidden>✦</div>
        <div>
          <h2>관리 · AI 문제 생성</h2>
          <p className="dim-text">
            난이도·단원 조건으로 문제를 만들면 학생 화면의 「AI 생성」·「모든문제」
            풀에 공개돼요.
          </p>
        </div>
      </header>

      <div className="admin-card">
        <div className="admin-card-head">
          <span className="dot" />
          <h3>생성 조건</h3>
          <span className="dim-text">조건을 고르고 생성을 누르세요</span>
        </div>
        <form className="admin-form" onSubmit={(e) => void onGenerate(e)}>
          <label>
            학교급
            <select
              value={school}
              onChange={(e) =>
                setSchool(e.target.value as "중학교" | "고등학교")
              }
            >
              <option value="중학교">중학교</option>
              <option value="고등학교">고등학교</option>
            </select>
          </label>
          <label>
            학년
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            단원
            <select
              value={unitCode}
              onChange={(e) => {
                setUnitCode(e.target.value);
                setTopicCode("");
              }}
            >
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            토픽 (선택)
            <select
              value={topicCode}
              onChange={(e) => setTopicCode(e.target.value)}
            >
              <option value="">(단원 내 자유)</option>
              {topics.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            난이도
            <select
              value={difficulty}
              onChange={(e) =>
                setDifficulty(e.target.value as (typeof DIFFS)[number])
              }
            >
              {DIFFS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            유형
            <select
              value={questionType}
              onChange={(e) =>
                setQuestionType(e.target.value as (typeof TYPES)[number])
              }
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            개수
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="admin-submit" disabled={busy}>
            {busy ? "만드는 중… (1~2분)" : "✦ AI 문제 생성"}
          </button>
        </form>
      </div>

      {error && <div className="notice error">{error}</div>}

      {(busy || liveDraft || liveReasoning || liveStage) && (
        <GenerateLivePanel
          busy={busy}
          stage={liveStage}
          index={liveIndex}
          total={liveTotal}
          attempt={liveAttempt}
          draft={liveDraft}
          reasoning={liveReasoning}
        />
      )}

      {created.length > 0 && (
        <section className="admin-section">
          <h3>
            <span>방금 생성한 문제</span>
            <span className="admin-pill">{created.length}개</span>
          </h3>
          {created.map((p) => (
            <div key={p.id} className="admin-preview">
              <ProblemView key={p.id} detail={p} nested />
            </div>
          ))}
        </section>
      )}

      <section className="admin-section">
        <h3>
          <span>관리자 AI 문제</span>
          <b>{listTotal.toLocaleString()}</b>
          <span>개</span>
          <span className="admin-pill">
            {listLoading ? "불러오는 중…" : "최신순"}
          </span>
        </h3>
        <ul className="admin-list">
          {list.map((g, i) => (
            <li key={g.id}>
              <button
                type="button"
                className="admin-item"
                onClick={() => void openItem(g.id)}
              >
                <span className="admin-item-meta">
                  <span className={`tag diff-${g.difficulty}`}>
                    {g.difficulty}
                  </span>
                  <span className="tag dim">
                    {g.unitLabel ?? g.unitCode}
                  </span>
                  <span className="admin-no">#{listTotal - i}</span>
                </span>
                <span className="admin-preview-text">
                  <MathText>{g.preview}</MathText>
                </span>
              </button>
              <button
                type="button"
                className="similar-del"
                onClick={() => void onDelete(g.id)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      </section>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setPreview(null)}
              aria-label="닫기"
            >
              ×
            </button>
            <ProblemView key={preview.id} detail={preview} nested />
          </div>
        </div>
      )}
    </div>
  );
}
