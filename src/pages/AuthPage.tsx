import { useState } from "react";
import { useAuth } from "../auth";

type Props = {
  onDone: () => void;
};

export default function AuthPage({ onDone }: Props) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(username.trim(), password);
      else await signup(username.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>{mode === "login" ? "로그인" : "회원가입"}</h2>
        <p className="dim-text">
          탐색·연습은 로그인 없이도 이용할 수 있어요. 비슷한 문제 만들기와 내
          문제는 로그인이 필요해요.
        </p>

        <div className="mode-tabs auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "on" : ""}
            onClick={() => setMode("login")}
          >
            로그인
          </button>
          <button
            type="button"
            className={mode === "signup" ? "on" : ""}
            onClick={() => setMode("signup")}
          >
            가입
          </button>
        </div>

        <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            아이디
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="영문·숫자·밑줄 3~20자"
              required
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder="8자 이상"
              required
            />
          </label>

          {error && <div className="notice error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}
          </button>
        </form>
      </div>
    </div>
  );
}
