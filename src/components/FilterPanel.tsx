import { useState } from "react";
import type { Filters, Meta } from "../types";
import { EMPTY_FILTERS } from "../types";

type Props = {
  meta: Meta;
  filters: Filters;
  onChange: (next: Filters) => void;
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export default function FilterPanel({ meta, filters, onChange }: Props) {
  const [draft, setDraft] = useState(filters.q);

  const visibleGrades = meta.grades.filter(
    (g) =>
      filters.schools.length > 0 && filters.schools.includes(g.school),
  );

  const visibleUnits = meta.units.filter((u) => {
    if (filters.schools.length && !filters.schools.includes(u.school)) {
      return false;
    }
    if (filters.grades.length && !filters.grades.includes(u.grade)) {
      return false;
    }
    return true;
  });

  const visibleTopics = filters.units.length
    ? meta.topics.filter((t) => filters.units.includes(t.unitCode))
    : [];

  const activeCount =
    filters.schools.length +
    filters.grades.length +
    filters.subjects.length +
    filters.units.length +
    filters.topics.length +
    filters.difficulties.length +
    filters.semesters.length +
    filters.questionTypes.length +
    (filters.hasImage ? 1 : 0) +
    (filters.q ? 1 : 0);

  return (
    <div className="filter-panel">
      <div className="filter-top">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ ...filters, q: draft.trim() });
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="키워드 검색"
            aria-label="키워드 검색"
          />
          <button type="submit">찾기</button>
        </form>

        <section>
          <h3>학교급</h3>
          <div className="seg-row">
            {meta.schools.map((s) => (
              <button
                key={s.value}
                className={`seg ${filters.schools.includes(s.value) ? "on" : ""}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    schools: toggle(filters.schools, s.value),
                    grades: [],
                    units: [],
                    topics: [],
                  })
                }
              >
                {s.value} <em>{s.count}</em>
              </button>
            ))}
          </div>
        </section>

        {visibleGrades.length > 0 && (
          <section>
            <h3>학년</h3>
            <div className="seg-row">
              {visibleGrades.map((g) => {
                const label =
                  filters.schools.length === 1
                    ? g.value
                    : `${g.school.replace("학교", "")} ${g.value}`;
                return (
                  <button
                    key={`${g.school}/${g.value}`}
                    className={`seg ${filters.grades.includes(g.value) ? "on" : ""}`}
                    onClick={() =>
                      onChange({
                        ...filters,
                        grades: toggle(filters.grades, g.value),
                        units: [],
                        topics: [],
                      })
                    }
                  >
                    {label} <em>{g.count}</em>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <div className="filter-scroll">
        <section>
          <h3>단원</h3>
          <div className="chip-col">
            {visibleUnits.length === 0 ? (
              <p className="filter-hint">
                학교급·학년을 고르면 단원이 표시돼요.
              </p>
            ) : (
              visibleUnits.map((u) => (
                <button
                  key={u.code}
                  className={`chip ${filters.units.includes(u.code) ? "on" : ""}`}
                  onClick={() =>
                    onChange({
                      ...filters,
                      units: toggle(filters.units, u.code),
                      topics: [],
                    })
                  }
                >
                  <span>{u.label}</span>
                  <em>{u.count}</em>
                </button>
              ))
            )}
          </div>
        </section>

        {visibleTopics.length > 0 && (
          <section>
            <h3>세부 토픽</h3>
            <div className="chip-col">
              {visibleTopics.map((t) => (
                <button
                  key={t.code}
                  className={`chip sub ${filters.topics.includes(t.code) ? "on" : ""}`}
                  onClick={() =>
                    onChange({
                      ...filters,
                      topics: toggle(filters.topics, t.code),
                    })
                  }
                >
                  <span>{t.label}</span>
                  <em>{t.count}</em>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="filter-bottom">
        <section>
          <h3>난이도</h3>
          <div className="seg-row">
            {meta.difficulties.map((d) => (
              <button
                key={d.value}
                className={`seg diff-${d.value} ${filters.difficulties.includes(d.value) ? "on" : ""}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    difficulties: toggle(filters.difficulties, d.value),
                  })
                }
              >
                {d.value} <em>{d.count}</em>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>학기</h3>
          <div className="seg-row">
            {meta.semesters.map((s) => (
              <button
                key={s.value}
                className={`seg ${filters.semesters.includes(s.value) ? "on" : ""}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    semesters: toggle(filters.semesters, s.value),
                  })
                }
              >
                {s.value}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>유형</h3>
          <div className="seg-row">
            {meta.questionTypes.map((t) => (
              <button
                key={t.value}
                className={`seg ${filters.questionTypes.includes(t.value) ? "on" : ""}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    questionTypes: toggle(filters.questionTypes, t.value),
                  })
                }
              >
                {t.value}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={filters.hasImage}
              onChange={(e) =>
                onChange({ ...filters, hasImage: e.target.checked })
              }
            />
            <span>도형·그래프 있는 문제만</span>
          </label>
        </section>

        {activeCount > 0 && (
          <button
            className="reset-btn"
            onClick={() => {
              setDraft("");
              onChange(EMPTY_FILTERS);
            }}
          >
            필터 초기화 ({activeCount})
          </button>
        )}
      </div>
    </div>
  );
}
