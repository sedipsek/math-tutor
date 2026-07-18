import { useEffect, useMemo, useState } from "react";
import { fetchProblem, fetchProblems } from "../api";
import type { Filters, Meta, ProblemDetail, ProblemList } from "../types";
import FilterPanel from "../components/FilterPanel";
import ProblemCard from "../components/ProblemCard";
import ProblemView from "../components/ProblemView";

const PAGE_SIZE = 12;

type Props = {
  meta: Meta;
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
};

export default function Browse({ meta, filters, onFiltersChange }: Props) {
  const [page, setPage] = useState(0);
  const [list, setList] = useState<ProblemList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProblemDetail | null>(null);

  const unitLabels = useMemo(
    () => new Map(meta.units.map((u) => [u.code, u.label])),
    [meta],
  );

  useEffect(() => {
    setPage(0);
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchProblems(filters, PAGE_SIZE, page * PAGE_SIZE, "all", controller.signal)
      .then(setList)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters, page]);

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

  const total = list?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="browse-layout">
      <aside className="browse-side">
        <FilterPanel meta={meta} filters={filters} onChange={onFiltersChange} />
      </aside>

      <main className="browse-main">
        <div className="result-bar">
          <p>
            <strong>{total.toLocaleString()}</strong>문제
          </p>
          {pageCount > 1 && (
            <nav className="pager">
              <button
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ←
              </button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button
                disabled={page + 1 >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                →
              </button>
            </nav>
          )}
        </div>

        {error && <div className="state-box error">{error}</div>}
        {!error && loading && <div className="state-box">불러오는 중…</div>}
        {!error && !loading && list?.items.length === 0 && (
          <div className="state-box">
            조건에 맞는 문제가 없어요. 필터를 풀어 보세요.
          </div>
        )}

        <div className="card-list">
          {list?.items.map((problem) => (
            <ProblemCard
              key={problem.id}
              problem={problem}
              unitLabel={unitLabels.get(problem.unitCode) ?? problem.unitCode}
              onOpen={setOpenId}
            />
          ))}
        </div>
      </main>

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
              <ProblemView key={detail.id} detail={detail} />
            ) : (
              <div className="state-box">불러오는 중…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
