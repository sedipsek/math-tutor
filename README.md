# math-tutor

중·고 수학 문제 유형 튜터 (로컬).

스택: **Vite (React) + Hono + Drizzle + Postgres**

## 구조

```
docs/           # 계획·데이터 문서
datasets/       # aihub-secondary 정리본 (gitignore)
scripts/        # 데이터 준비·정제·카탈로그 스크립트
src/            # Vite + React UI (탐색 / 연습 모드)
server/         # Hono API
  routes/       #   meta · problems(목록/랜덤/상세/이미지)
  lib/          #   콘텐츠 구조화(선택지 파싱 등) · 쿼리 검증
  db/           #   Drizzle 스키마 · ingest · 시드
drizzle/        # SQL 마이그레이션
docker-compose.yml
```

## 빠른 시작

```bash
npm install
npm run db:up       # Postgres
npm run db:migrate  # 스키마
npm run db:seed     # units / topics
npm run db:ingest   # aihub-secondary → Postgres
npm run dev         # UI :5173 · Hono API :3001 (프록시 /api)
```

DB: `postgresql://math:math@localhost:5432/math_tutor` (`.env.local`)

데이터 재생성: [`docs/dataset.md`](docs/dataset.md)

## API (`:3001`, Vite는 `/api` 프록시)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스 |
| GET | `/api/meta` | 학교급·학년·단원·토픽·난이도·학기·유형 + 문제 수 (`school=`, `grade=`로 단원 좁히기) |
| GET | `/api/problems` | 필터 검색 (CSV: `school=`, `grade=`, `subject=`, `unit=`, `topic=`, `difficulty=`, `semester=`, `type=`, `q=`, `hasImage=`, `limit=`, `offset=`) |
| GET | `/api/problems/random` | 조건 내 랜덤 1문제 (`exclude=`로 직전 문제 제외) — 연습 모드 |
| GET | `/api/problems/:id` | 상세 — 서버에서 stem/선택지/정답/해설 구조화 |
| POST | `/api/problems/:id/similar` | 유사 문제 생성·저장 (LLM, 20~60초) |
| GET | `/api/generated?source=` | 원본별 생성 문제 목록 |
| GET | `/api/generated/:id` | 생성 문제 상세 |
| DELETE | `/api/generated/:id` | 생성 문제 삭제 |
| GET | `/api/problems/:id/assets/*` | stem 이미지 |

## UI

- **탐색**: 필터(학교급 → 학년 → 단원) + 카드 그리드 + 상세 모달 (정답·해설 토글)
- **연습**: 조건 내 랜덤 출제 → 선택지 클릭 → 채점 → 해설, 세션 통계(푼 문제/정답/연속)
- **유사 생성**: 문제 상세에서 「비슷한 문제 만들기」 → DB 저장 후 다시 풀기

환경변수 (`.env.local`, git 제외):
- DB: `DATABASE_URL`
- LLM: `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MAX_TOKENS` / `LLM_MODEL`
- (선택) 비전: `LLM_VISION_MODEL` / `LLM_VISION_MAX_TOKENS`
- (선택) 어드민 시드: `ADMIN_USERNAME` / `ADMIN_PASSWORD` — 없으면 시드 안 함

## 브랜치

- `main`: 현재 기본 브랜치

## 문서

- [계획서](docs/PLAN.md)
- [데이터셋](docs/dataset.md)
