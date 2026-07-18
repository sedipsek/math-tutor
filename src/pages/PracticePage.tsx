import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRandom } from "../api";
import { useAuth } from "../auth";
import type { Filters, Pool, ProblemDetail } from "../types";
import PoolTabs from "../components/PoolTabs";
import ProblemView from "../components/ProblemView";

type Props = {
  filters: Filters;
  pool: Pool;
  onPoolChange: (pool: Pool) => void;
  onNeedLogin: () => void;
};

type Stats = { solved: number; correct: number; streak: number };

export default function PracticePage({
  filters,
  pool,
  onPoolChange,
  onNeedLogin,
}: Props) {
  const { user } = useAuth();
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [matched, setMatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<Stats>({
    solved: 0,
    correct: 0,
    streak: 0,
  });
  const recentIds = useRef<string[]>([]);

  const draw = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      fetchRandom(filters, recentIds.current, pool, signal)
        .then(({ matched, problem }) => {
          setMatched(matched);
          setProblem(problem);
          recentIds.current = [...recentIds.current, problem.id].slice(-20);
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            setError(err.message);
            setProblem(null);
          }
        })
        .finally(() => setLoading(false));
    },
    [filters, pool],
  );

  useEffect(() => {
    recentIds.current = [];
    const controller = new AbortController();
    draw(controller.signal);
    return () => controller.abort();
  }, [draw]);

  function onJudge(correct: boolean) {
    setStats((s) => ({
      solved: s.solved + 1,
      correct: s.correct + (correct ? 1 : 0),
      streak: correct ? s.streak + 1 : 0,
    }));
  }

  return (
    <div className="practice">
      <div className="practice-bar">
        <div className="stats">
          <span>
            푼 문제 <b>{stats.solved}</b>
          </span>
          <span>
            정답 <b>{stats.correct}</b>
          </span>
          <span>
            연속 <b>{stats.streak}</b>
          </span>
          <span className="dim-text">
            조건 일치 {matched.toLocaleString()}문제
          </span>
        </div>
        <button className="next-btn" disabled={loading} onClick={() => draw()}>
          다음 문제 →
        </button>
      </div>

      <PoolTabs
        value={pool}
        onChange={onPoolChange}
        loggedIn={Boolean(user)}
        onNeedLogin={onNeedLogin}
      />

      {error && <div className="notice error">{error}</div>}
      {loading && !problem && <div className="notice">뽑는 중…</div>}

      {problem && (
        <div className={loading ? "fade" : ""}>
          <ProblemView
            key={problem.id}
            detail={problem}
            interactive
            onJudge={onJudge}
            onNeedLogin={onNeedLogin}
          />
        </div>
      )}
    </div>
  );
}
