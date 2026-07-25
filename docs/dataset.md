# aihub-secondary 데이터셋

경로: `datasets/aihub-secondary/` (git 제외, 로컬 전용)

중·고 전체 (초등 제외). 원본은 `datasets/aihub-71859/` (gitignore).

**출처:** [AI 허브 — 수학 교과 문제 풀이과정 데이터 (71859)](https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=data&dataSetSn=71859)  
한국지능정보사회진흥원(NIA) 및 수행기관. 이용정책: https://aihub.or.kr/intrcn/guid/usagepolicy.do  
원본 데이터의 재배포·제3자 제공은 하지 않습니다.

```
aihub-secondary/
  manifest.jsonl
  stats.json
  quarantine.json
  problems/
    S3_중등_3_XXXXXX/
      problem.json
      crops/
        stem_image_0.png   # 도형 있을 때만
```

## 범위

| 학교급 | 학년 | ready (대략) |
|--------|------|-------------:|
| 중학교 | 1학년 | 3006 |
| 중학교 | 2학년 | 3149 |
| 중학교 | 3학년 | 2783 |
| 고등학교 | 1학년 | 1056 |

전체 ready **9994** / quarantine **234** (선택지·해설 결손 등).

## problem.json 필드

`id`, `school`, `grade`, `subject`,  
`question_type`, `semester`, `difficulty`, `topic_codes`, `unit_codes`,  
`date`, `publisher`, `publication_year`, `revision_year`,  
`crops[]` (`slug`, `index`, `path`, `text`), `quality` (`status`, `issues`)

- 이미지는 **stem_image만** (`path`가 있을 때)
- 문항/정답/해설은 `crops[].text` (LaTeX)
- 원문 근거가 없어 복원할 수 없는 누락 문제는 `quarantined`로 보존하며 DB 적재에서 제외

## 파이프라인

```bash
# 원본 중·고 zip → extracted (aihubshell)
python3 scripts/prepare_aihub_secondary.py
python3 scripts/curate_aihub_secondary.py
python3 scripts/build_catalog.py   # → server/db/catalog.generated.ts
npm run db:ingest
```
