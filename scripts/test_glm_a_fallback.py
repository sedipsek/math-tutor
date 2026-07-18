#!/usr/bin/env python3
"""glm A안(이미지 유지·텍스트만) 품질 스모크."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PID = "S3_고등_1_006446"


def load_env() -> None:
    env = ROOT / ".env.local"
    for line in env.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v)


def bodies(crops: list, prefix: str) -> list[str]:
    return [
        c["text"]
        for c in crops
        if c.get("slug", "").startswith(prefix) and c.get("text")
    ]


def chat(model: str, messages: list, max_tokens: int) -> dict:
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    req = Path("/tmp/glm_a_req.json")
    req.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    base = os.environ["LLM_BASE_URL"].rstrip("/")
    key = os.environ["LLM_API_KEY"]
    proc = subprocess.run(
        [
            "curl",
            "-sS",
            "-m",
            "180",
            f"{base}/chat/completions",
            "-H",
            f"Authorization: Bearer {key}",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            f"@{req}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    return json.loads(proc.stdout)


def strip_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", text)
    return m.group(1).strip() if m else text


def main() -> int:
    load_env()
    problem = json.loads(
        (ROOT / "datasets/aihub-secondary/problems" / PID / "problem.json").read_text(
            encoding="utf-8"
        )
    )
    crops = problem["crops"]
    stem = bodies(crops, "stem_text")
    ans = bodies(crops, "answer")
    wrong = bodies(crops, "wrong")
    expl = bodies(crops, "explanation")
    img = next(c for c in crops if c.get("slug") == "stem_image" and c.get("path"))
    img_path = ROOT / "datasets/aihub-secondary/problems" / PID / img["path"]

    print("=== ORIGINAL ===")
    print("id:", PID)
    print("stem:\n", "\n".join(stem))
    print("answer:\n", "\n".join(ans))
    print("wrong:\n", "\n".join(wrong))
    print("expl:\n", "\n".join(expl)[:500])
    print("image:", img_path, "bytes", img_path.stat().st_size)

    system_a = """너는 중·고 수학 교재 문항을 만드는 출제자야.
원본에는 도형/그래프 이미지가 있고, 그 이미지는 학생에게 그대로 보여진다(이미지 파일은 바꾸지 않음).
너는 이미지를 볼 수 없으니 아래 텍스트만으로 그림 내용을 추론하고,
그 그림과 모순되지 않는 유사 변형 문제를 JSON으로 만들어라.
숫자·식·표현은 바꿔도 되지만 그림에 없는 요소를 있다고 가정하면 안 된다.
수식은 KaTeX $...$ / $$...$$.
응답은 JSON만. 코드펜스 금지.
스키마:
{"stem":"...","choices":["1","2","3","4","5"],"answerIndex":0,"explanation":"..."}
choices 정확히 5개, answerIndex 0~4."""

    user_a = f"""원본 메타: 고등학교 1학년 / 객관식 / 난이도 {problem.get("difficulty")}
이미지는 유지된다. 텍스트만 보고 유사 문제를 만들어라.

[문항]
{chr(10).join(stem)}

[정답 원문]
{chr(10).join(ans)}

[오답/선택지 원문]
{chr(10).join(wrong)}

[해설]
{chr(10).join(expl)[:800]}
"""

    print("\n=== GLM A (no vision, keep-image instruction) ===")
    data = chat(
        os.environ["LLM_MODEL"],
        [
            {"role": "system", "content": system_a},
            {"role": "user", "content": user_a},
        ],
        int(os.environ.get("LLM_MAX_TOKENS", "131071")),
    )
    if "error" in data:
        print("ERROR", data["error"])
        return 1

    content = data["choices"][0]["message"].get("content") or ""
    print("model:", data.get("model"))
    print("usage:", data.get("usage"))
    print("--- raw ---")
    print(content[:2500])

    try:
        parsed = json.loads(strip_fence(content))
    except Exception as exc:
        print("JSON parse fail:", exc)
        return 1

    print("--- parsed ---")
    print("stem:", parsed.get("stem"))
    print("choices:", parsed.get("choices"))
    print("answerIndex:", parsed.get("answerIndex"))
    print("explanation:", (parsed.get("explanation") or "")[:600])

    # 간단 품질 체크리스트
    stem_l = (parsed.get("stem") or "").lower()
    checks = {
        "json_ok": True,
        "has_5_choices": isinstance(parsed.get("choices"), list)
        and len(parsed["choices"]) == 5,
        "answer_in_range": isinstance(parsed.get("answerIndex"), int)
        and 0 <= parsed["answerIndex"] <= 4,
        "mentions_division_or_cubic": any(
            k in (parsed.get("stem") or "")
            for k in ["나누", "삼차", "나머지", "몫", "일차식"]
        ),
        "keeps_image_framing": any(
            k in (parsed.get("stem") or "")
            for k in ["오른쪽", "그림", "과정", "나타낸"]
        ),
        "not_identical_stem": (parsed.get("stem") or "").strip()
        != "\n".join(stem).strip(),
    }
    print("--- checks ---")
    for k, v in checks.items():
        print(f"{k}: {v}")
    print("pass_count:", sum(checks.values()), "/", len(checks))
    return 0 if all(checks.values()) else 2


if __name__ == "__main__":
    sys.exit(main())
