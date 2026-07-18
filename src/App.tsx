import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router";
import { fetchMeta } from "./api";
import { AuthProvider, useAuth } from "./auth";
import type { Filters, Meta, Pool } from "./types";
import { EMPTY_FILTERS } from "./types";
import FilterPanel from "./components/FilterPanel";
import AdminPage from "./pages/AdminPage";
import AuthPage from "./pages/AuthPage";
import BrowsePage from "./pages/BrowsePage";
import PracticePage from "./pages/PracticePage";

type FilterOutlet = {
  meta: Meta;
  filters: Filters;
  pool: Pool;
  setPool: (p: Pool) => void;
  onNeedLogin: () => void;
};

function Brand({ meta }: { meta: Meta | null }) {
  return (
    <NavLink to="/problems" className="brand">
      <span className="brand-sigma">Σ</span>
      <div>
        <h1>수학 유형 튜터</h1>
        <p>중·고 · {meta ? meta.total.toLocaleString() : "…"}문제</p>
      </div>
    </NavLink>
  );
}

function TopAccount() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) return <span className="dim-text">…</span>;

  if (user) {
    return (
      <>
        <span className="account-name">
          {user.username}
          {user.role === "admin" ? " · admin" : ""}
        </span>
        <button
          type="button"
          className="account-btn"
          onClick={() => void logout()}
        >
          로그아웃
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      className="account-btn primary"
      onClick={() =>
        navigate("/login", { state: { from: location.pathname } })
      }
    >
      로그인
    </button>
  );
}

function AppShell({
  meta,
  metaError,
}: {
  meta: Meta | null;
  metaError: string;
}) {
  const { user } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <Brand meta={meta} />
        <div className="topbar-right">
          <nav className="mode-tabs">
            <NavLink
              to="/problems"
              className={({ isActive }) => (isActive ? "on" : "")}
            >
              탐색
            </NavLink>
            <NavLink
              to="/practice"
              className={({ isActive }) => (isActive ? "on" : "")}
            >
              연습
            </NavLink>
            {user?.role === "admin" && (
              <NavLink
                to="/admin"
                className={({ isActive }) => (isActive ? "on" : "")}
              >
                관리
              </NavLink>
            )}
          </nav>
          <div className="account">
            <TopAccount />
          </div>
        </div>
      </header>

      {metaError ? (
        <div className="notice error">
          {metaError} — API 서버(:3001)가 실행 중인지 확인해 주세요.
        </div>
      ) : !meta ? (
        <div className="notice">준비 중…</div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

function FilterLayout({
  meta,
  filters,
  setFilters,
  pool,
  setPool,
}: {
  meta: Meta;
  filters: Filters;
  setFilters: (f: Filters) => void;
  pool: Pool;
  setPool: (p: Pool) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  function onNeedLogin() {
    navigate("/login", { state: { from: location.pathname } });
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <FilterPanel meta={meta} filters={filters} onChange={setFilters} />
      </aside>
      <main className="content">
        <Outlet
          context={
            {
              meta,
              filters,
              pool,
              setPool,
              onNeedLogin,
            } satisfies FilterOutlet
          }
        />
      </main>
    </div>
  );
}

function BrowseRoute() {
  const ctx = useOutletContext<FilterOutlet>();
  return (
    <BrowsePage
      meta={ctx.meta}
      filters={ctx.filters}
      pool={ctx.pool}
      onPoolChange={ctx.setPool}
      onNeedLogin={ctx.onNeedLogin}
    />
  );
}

function PracticeRoute() {
  const ctx = useOutletContext<FilterOutlet>();
  return (
    <PracticePage
      filters={ctx.filters}
      pool={ctx.pool}
      onPoolChange={ctx.setPool}
      onNeedLogin={ctx.onNeedLogin}
    />
  );
}

function AdminRoute({ meta }: { meta: Meta }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="notice">준비 중…</div>;
  if (!user || user.role !== "admin") {
    return <Navigate to="/problems" replace />;
  }
  return <AdminPage meta={meta} />;
}

function LoginRoute() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromRaw = (location.state as { from?: string } | null)?.from;
  const from =
    fromRaw && fromRaw !== "/login" ? fromRaw : "/problems";

  useEffect(() => {
    if (!loading && user) {
      const dest =
        from === "/admin" && user.role !== "admin" ? "/problems" : from;
      navigate(dest, { replace: true });
    }
  }, [user, loading, from, navigate]);

  if (loading) return <div className="notice">준비 중…</div>;
  if (user) return null;

  return (
    <AuthPage
      onDone={() => {
        void refresh();
      }}
    />
  );
}

function AppRoutes() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [pool, setPool] = useState<Pool>("all");

  useEffect(() => {
    fetchMeta()
      .then(setMeta)
      .catch((err) => setMetaError(err.message));
  }, []);

  return (
    <Routes>
      <Route element={<AppShell meta={meta} metaError={metaError} />}>
        <Route index element={<Navigate to="/problems" replace />} />
        <Route
          element={
            meta ? (
              <FilterLayout
                meta={meta}
                filters={filters}
                setFilters={setFilters}
                pool={pool}
                setPool={setPool}
              />
            ) : null
          }
        >
          <Route path="problems" element={<BrowseRoute />} />
          <Route path="practice" element={<PracticeRoute />} />
        </Route>
        <Route
          path="admin"
          element={meta ? <AdminRoute meta={meta} /> : null}
        />
        <Route path="login" element={<LoginRoute />} />
        <Route path="*" element={<Navigate to="/problems" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
