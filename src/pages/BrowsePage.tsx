import { useEffect, useState } from "react";
import { fetchProblem, fetchProblems } from "../api";
import { useAuth } from "../auth";
import type { Filters, Meta, Pool, ProblemDetail, ProblemList } from "../types";
import MathText from "../components/MathText";
import PoolTabs from "../components/PoolTabs";
import ProblemView from "../components/ProblemView";

const PAGE_SIZE = 12;

type Props = {
  meta: Meta;
  filters: Filters;
  pool: Pool;
  onPoolChange: (pool: Pool) => void;
  onNeedLogin: () => void;
};

export default function BrowsePage({
  meta,
  filters,
  pool,
  onPoolChange,
  onNeedLogin,
}: Props) {
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<ProblemList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProblemDetail | null>(null);

  const unitLabel = new Map(meta.units.map((u) => [u.code, u.label]));

  useEffect(() => {
    setOffset(0);
  }, [filters, pool]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchProblems(filters, PAGE_SIZE, offset, pool, controller.signal)
      .then(setList)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters, offset, pool]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    fetchProblem(openId, controller.signal)
      .then(setDetail)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [openId]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const total = list?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="browse">
      <div className="browse-head">
        <div className="browse-title">
          <h2>
            문제 <b>{total.toLocaleString()}</b>개
          </h2>
          <PoolTabs
            value={pool}
            onChange={onPoolChange}
            loggedIn={Boolean(user)}
            onNeedLogin={onNeedLogin}
          />
        </div>
        <div className="pager">
          <button
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            ←
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            disabled={loading || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            →
          </button>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      {loading ? (
        <div className="notice">불러오는 중…</div>
      ) : list && list.items.length === 0 ? (
        <div className="notice">
          조건에 맞는 문제가 없어요. 필터를 조금 풀어 보세요.
        </div>
      ) : (
        <ul className="card-grid">
          {list?.items.map((p) => (
            <li key={p.id}>
              <button className="p-card" onClick={() => setOpenId(p.id)}>
                <div className="p-card-tags">
                  {p.generated && <span className="tag gen">AI</span>}
                  <span className={`tag diff-${p.difficulty}`}>
                    {p.difficulty}
                  </span>
                  <span className="tag dim">
                    {unitLabel.get(p.unitCode) ?? p.unitCode}
                  </span>
                  <span className="tag dim">{p.questionType}</span>
                </div>
                <p className="p-card-preview">
                  {p.preview ? (
                    <MathText>{p.preview}</MathText>
                  ) : (
                    "(그림으로 제시된 문제)"
                  )}
                </p>
                {p.thumbnail && (
                  <img src={p.thumbnail} alt="" loading="lazy" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <div className="modal-backdrop" onClick={() => setOpenId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setOpenId(null)}
              aria-label="닫기"
            >
              ×
            </button>
            {detail ? (
              <ProblemView
                key={detail.id}
                detail={detail}
                onNeedLogin={onNeedLogin}
              />
            ) : (
              <div className="notice">불러오는 중…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
