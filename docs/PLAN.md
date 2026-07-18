# 수학 문제 유형 튜터 — 계획서

## 1. 한줄 목표

유저가 **학교급 · 학년 · 단원 · 난이도 · 키워드**를 넣으면, 그에 맞는 수학 문제를 **찾아주거나(1차) / 유사 생성해서(2차)** 제공하는 튜터.

**타깃**: 중학교 1–3학년 + 고등학교 1학년 (초등 제외)  
**데이터**: [AI Hub 수학 교과 문제 풀이과정 데이터 (71859)](https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=data&dataSetSn=71859) **만** 사용

---

## 2. 범위


| 단계      | 내용                  |
| ------- | ------------------- |
| **MVP** | AI Hub 중·고 문제 검색·제공 |
| **v2**  | 유사 문제 생성            |
| **v3**  | 풀이 피드백·정오답 판정       |


스택: **TypeScript + Vite(React) + Hono + Drizzle + Postgres (로컬)**

---

## 3. 데이터 (AI Hub only)

- 데이터셋 SN: `71859` → 정리본: `datasets/aihub-secondary/`
- ready **9,994문제** (중 8938 / 고 1056) — quarantine 234 제외
- 원본: `datasets/aihub-71859/` (gitignore). 이미지는 `stem_image` **크롭만** 보관
- 난이도: `상` | `중` | `하` · 학기: `1학기` | `2학기` | `공통`
- `problem.json`에 `school`, `grade`, `subject` + 저작권 메타



### 3.1 디렉터리 구조

```
datasets/aihub-secondary/
  manifest.jsonl
  stats.json
  problems/
    S3_중등_3_003131/
      problem.json
      crops/
        stem_image_0.png
```

- 데이터 문서: `[docs/dataset.md](dataset.md)`
- 재생성: `prepare_aihub_secondary.py` → `curate_aihub_secondary.py` → `build_catalog.py`

---



## 4. 단원 체계

단원·토픽은 **AI Hub** `2022_achievement_standard` **코드** 기준.  
시드: `server/db/catalog.generated.ts` (`python3 scripts/build_catalog.py`).


| band | 단원 코드               | 학교급·학년   |
| ---- | ------------------- | -------- |
| MS1  | `MS1-01` … `MS1-06` | 중학교 1학년  |
| MS2  | `MS2-01` … `MS2-08` | 중학교 2학년  |
| MS3  | `MS3-01` … `MS3-10` | 중학교 3학년  |
| HS1  | `HS1-01` … `HS1-06` | 고등학교 1학년 |


토픽 = 성취기준 (`9수XX-YY`, `10공수1-…`, `10공수2-…`). 라벨은 `build_catalog.py` 테이블 + 없으면 코드 그대로.

---



## 5. 문제 JSON 스키마 (온디스크)

```json
{
  "id": "S3_중등_3_003131",
  "school": "중학교",
  "grade": "3학년",
  "subject": "수학",
  "question_type": "객관식",
  "semester": "공통",
  "difficulty": "중",
  "topic_codes": ["9수01-10"],
  "unit_codes": ["MS3-01"],
  "date": "2024-09-06",
  "publisher": "교학사",
  "publication_year": "2015-03-01",
  "revision_year": "2015",
  "crops": [
    { "slug": "stem_text", "index": 0, "path": null, "text": "…" },
    { "slug": "stem_image", "index": 0, "path": "crops/stem_image_0.png", "text": "…" }
  ],
  "quality": { "status": "ready", "issues": [] }
}
```



### 5.1 Postgres (Drizzle)


| 테이블              | 역할                                                 |
| ---------------- | -------------------------------------------------- |
| `units`          | 단원 코드·라벨·`school`·`grade`                          |
| `topics`         | 성취기준 코드·라벨·`unit_code`                             |
| `problems`       | 문항 메타 (`school`/`grade`/`subject` + `search_text`) |
| `problem_topics` | 문제↔토픽                                              |
| `problem_crops`  | crop 행                                             |


인덱스: `(school, grade)` / `unit_code` / `difficulty` / `semester` + `search_text` **pg_trgm** GIN  
자산 경로: `datasets/aihub-secondary/problems/{id}/…`

---



## 6. 시스템 · 로드맵

```
UI (Vite/React) → API (Hono) → Postgres ← ingest(AI Hub 중·고)
```



### Phase 0–1

- [x] AI Hub 중·고 다운로드·정리 (`aihub-secondary`)
- [x] 단원 카탈로그 생성 + school/grade 스키마
- [x] ingest · 필터 API · UI (학교급 → 학년 → 단원)



### Phase 2

- [x] 유사 문제 생성 (LLM, `generated_problems` 저장)
- [x] AI 해설 생성(2개생성, 해당 학교, 학년에 맞는 난이도로)
- [x] 회원가입/로그인 (세션 쿠키) + Admin 패널 (조건 기반 AI 문제 생성)
- [x] 학생 UX 문제 풀 전환 (모든문제 / 교재 / AI / 내 문제)



### Phase 3~

- [x] 풀이 피드백 (객관식 선택지 / 주관식 오답 입력)

---



## 6.1 유사 문제 생성 (유저)

원본 문제 상세에서 **비슷한 문제 만들기** → 로그인 필요 → Team Wicked API로 변형 → `generated_problems`에 `origin=user`, `ownerId=본인`으로 저장. **본인만** 「내 문제」 풀·해당 원본의 유사 목록에서 보임.


| 항목    | 내용                                                                            |
| ----- | ----------------------------------------------------------------------------- |
| 분류    | 원본에 `stem_image` 파일 있으면 **이미지 문항**, 없으면 **텍스트 문항**                            |
| 텍스트   | `LLM_MODEL` = `teamwicked-glm5.2`                                             |
| 이미지   | `LLM_VISION_MODEL` = `teamwicked-kimiK2.7code` — 그림을 보고 변형, **원본 PNG 경로 재사용** |
| 출력    | stem/선택지/정답/해설 텍스트 + (이미지 문항이면) 원본 `stem_image` 표시                            |
| 어태치먼트 | 실제 파일은 `stem_image`만. `answer_image` 등은 path 없이 텍스트 crop                      |
| 테이블   | `generated_problems` (+ `stem_image_path`, `origin`, `owner_id`)               |
| API   | `POST /api/problems/:id/similar` (인증), `GET/DELETE /api/generated…`           |
| UI    | ProblemView 하단 생성 버튼 · 본인 목록 · 다시 풀기                                          |


---



## 6.2 계정 · Admin 조건 생성 · 문제 풀

### 인증

- `users` (`student` | `admin`) + `sessions` (DB 토큰, `sid` httpOnly 쿠키, 30일)
- 비밀번호: Node `scrypt` 자체 포맷 (`server/lib/password.ts`)
- API: `POST /api/auth/signup|login|logout`, `GET /api/auth/me`
- 탐색·연습(GET)은 비로그인 허용. 유사 생성·`pool=mine`·삭제는 로그인 필요
- Admin 시드: `ADMIN_USERNAME` / `ADMIN_PASSWORD` 환경변수로 서버 기동 시 upsert (코드에 비밀번호 없음)

### Admin 패널 (조건 기반 AI 문제)

학생 화면의 「비슷한 문제 만들기」와 별개. **학교급·학년·단원·(토픽)·난이도·유형**으로 새 문항을 만들고 `origin=admin`으로 저장 → **전체 학생에게 공개**.

| 항목 | 내용 |
| --- | --- |
| 생성 | `POST /api/admin/generate` (`requireAdmin`) — 동일 조건 교재 2~3문항 few-shot + glm 텍스트 |
| 목록 | `GET /api/admin/generated` |
| UI | 헤더 「관리」탭 (`role=admin`만) |

### 문제 풀 (`pool` 쿼리)

| 풀 | 구성 |
| --- | --- |
| `all` (기본) | 교재(`problems`) + Admin AI |
| `textbook` | 교재만 (AI Hub 출처, UI 표기 **교재 문제**) |
| `ai` | Admin AI만 |
| `mine` | 로그인한 유저가 만든 유사 문제만 |

목록·랜덤: `GET /api/problems?pool=…`, `GET /api/problems/random?pool=…`

---



## 7. 기술


| 영역           | 선택                                                   |
| ------------ | ---------------------------------------------------- |
| Vite + React | UI (`src/`, `:5173`)                                 |
| **Hono**     | API (`server/`, `:3001`)                             |
| Drizzle      | Postgres ORM                                         |
| Postgres     | 로컬 (Docker Compose), `pg_trgm`                       |
| Auth         | 세션 쿠키 + scrypt                                      |
| LLM          | Team Wicked chat completions (`.env.local`의 `LLM_*`) |


---



## 8. 결정 요약

- 데이터: **AI Hub 71859 중·고 (초등 제외)** — UI 명칭 **교재 문제**
- 정리본: `datasets/aihub-secondary/`
- 필터: 학교급 → 학년 → 단원 → 난이도/학기/유형/키워드
- 계정: 가입/로그인, Admin 조건 생성은 전체 공개, 유저 유사 생성은 본인만
- 문제 풀: 모든문제 / 교재 / AI / 내 문제
- 스택: **Vite(React) + Hono + Drizzle + Postgres**, 로컬

