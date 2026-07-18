import type { Pool } from "../types";

const OPTIONS: Array<{ value: Pool; label: string }> = [
  { value: "all", label: "모든문제" },
  { value: "textbook", label: "교재 문제" },
  { value: "ai", label: "AI 생성" },
  { value: "mine", label: "내 문제" },
];

type Props = {
  value: Pool;
  onChange: (pool: Pool) => void;
  loggedIn: boolean;
  onNeedLogin: () => void;
};

export default function PoolTabs({
  value,
  onChange,
  loggedIn,
  onNeedLogin,
}: Props) {
  return (
    <div className="pool-tabs" role="tablist" aria-label="문제 풀">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={value === opt.value ? "on" : ""}
          onClick={() => {
            if (opt.value === "mine" && !loggedIn) {
              onNeedLogin();
              return;
            }
            onChange(opt.value);
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
