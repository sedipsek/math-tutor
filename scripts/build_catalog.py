#!/usr/bin/env python3
"""Scan aihub-secondary and emit server/db/catalog.generated.ts."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets" / "aihub-secondary" / "problems"
OUT = ROOT / "server" / "db" / "catalog.generated.ts"

UNIT_LABELS = {
    "MS1-01": "수와 연산",
    "MS1-02": "문자와 식·방정식",
    "MS1-03": "좌표와 그래프",
    "MS1-04": "기본 도형",
    "MS1-05": "원과 입체",
    "MS1-06": "자료의 정리",
    "MS2-01": "유리수와 순환소수",
    "MS2-02": "식의 계산",
    "MS2-03": "부등식과 연립방정식",
    "MS2-04": "일차함수",
    "MS2-05": "삼각형과 사각형",
    "MS2-06": "닮음",
    "MS2-07": "피타고라스 정리",
    "MS2-08": "확률",
    "MS3-01": "제곱근과 실수",
    "MS3-02": "다항식의 곱셈과 인수분해",
    "MS3-03": "이차방정식",
    "MS3-04": "이차함수",
    "MS3-05": "피타고라스 정리",
    "MS3-06": "삼각비",
    "MS3-07": "원의 성질",
    "MS3-08": "대푯값",
    "MS3-09": "산포도",
    "MS3-10": "산점도와 상관관계",
    "HS1-01": "다항식",
    "HS1-02": "방정식과 부등식",
    "HS1-03": "경우의 수",
    "HS1-04": "도형의 방정식",
    "HS1-05": "집합과 명제",
    "HS1-06": "함수",
}

TOPIC_LABELS = {
    "9수01-01": "소인수분해",
    "9수01-02": "최대공약수와 최소공배수",
    "9수01-03": "정수와 유리수",
    "9수01-04": "정수·유리수의 대소",
    "9수01-05": "정수·유리수의 사칙계산",
    "9수01-06": "순환소수",
    "9수01-07": "제곱근의 뜻과 성질",
    "9수01-08": "무리수의 개념",
    "9수01-09": "실수의 대소 관계",
    "9수01-10": "근호를 포함한 식의 사칙계산",
    "9수02-01": "문자를 사용한 식",
    "9수02-02": "일차식의 덧셈과 뺄셈",
    "9수02-03": "방정식과 등식의 성질",
    "9수02-04": "일차방정식",
    "9수02-05": "순서쌍과 좌표",
    "9수02-06": "그래프의 해석",
    "9수02-07": "정비례와 반비례",
    "9수02-08": "지수법칙",
    "9수02-09": "다항식의 덧셈과 뺄셈",
    "9수02-10": "단항식과 다항식의 곱셈·나눗셈",
    "9수02-11": "부등식의 성질",
    "9수02-12": "일차부등식",
    "9수02-13": "연립일차방정식",
    "9수02-14": "함수의 개념",
    "9수02-15": "일차함수의 개념",
    "9수02-16": "일차함수의 그래프",
    "9수02-17": "일차함수와 일차방정식",
    "9수02-18": "두 일차함수와 연립방정식",
    "9수02-19": "다항식의 곱셈과 인수분해",
    "9수02-20": "이차방정식",
    "9수02-21": "이차함수의 개념",
    "9수02-22": "이차함수의 그래프와 성질",
    "9수03-01": "점·선·면·각",
    "9수03-02": "평행선의 성질",
    "9수03-03": "삼각형의 작도",
    "9수03-04": "삼각형의 합동",
    "9수03-05": "다각형의 성질",
    "9수03-06": "부채꼴",
    "9수03-07": "다면체와 회전체",
    "9수03-08": "입체도형의 겉넓이와 부피",
    "9수03-09": "이등변삼각형",
    "9수03-10": "삼각형의 외심과 내심",
    "9수03-11": "사각형의 성질",
    "9수03-12": "도형의 닮음",
    "9수03-13": "삼각형의 닮음",
    "9수03-14": "평행선 사이의 선분의 길이의 비",
    "9수03-15": "피타고라스 정리",
    "9수03-16": "삼각비의 뜻과 값",
    "9수03-17": "삼각비의 활용",
    "9수03-18": "원의 현·접선",
    "9수03-19": "원주각",
    "9수04-01": "대푯값(중앙값·최빈값)",
    "9수04-02": "자료의 정리와 해석",
    "9수04-03": "상대도수",
    "9수04-05": "경우의 수",
    "9수04-06": "확률",
    "9수04-07": "분산과 표준편차",
    "9수04-09": "산점도와 상관관계",
    "10공수1-01-01": "다항식의 사칙연산",
    "10공수1-01-02": "항등식과 나머지정리",
    "10공수1-01-03": "다항식의 인수분해",
    "10공수1-02-01": "복소수",
    "10공수1-02-02": "이차방정식의 판별식",
    "10공수1-02-03": "근과 계수의 관계",
    "10공수1-02-04": "이차방정식과 이차함수",
    "10공수1-02-05": "이차함수와 직선의 위치 관계",
    "10공수1-02-06": "이차함수의 최대·최소",
    "10공수1-02-07": "삼차·사차방정식",
    "10공수1-02-08": "연립이차방정식",
    "10공수1-02-09": "연립일차부등식",
    "10공수1-02-10": "절댓값 부등식",
    "10공수1-02-11": "이차부등식",
    "10공수1-03-01": "합의 법칙과 곱의 법칙",
    "10공수1-03-02": "순열",
    "10공수1-03-03": "조합",
    "10공수2-01-01": "선분의 내분",
    "10공수2-01-02": "두 직선의 평행·수직",
    "10공수2-01-03": "점과 직선 사이의 거리",
    "10공수2-01-04": "원의 방정식",
    "10공수2-01-05": "원과 직선의 위치 관계",
    "10공수2-01-06": "평행이동",
    "10공수2-01-07": "대칭이동",
    "10공수2-02-01": "집합의 개념",
    "10공수2-02-02": "집합의 포함관계",
    "10공수2-02-03": "집합의 연산",
    "10공수2-02-04": "명제와 조건",
    "10공수2-02-05": "명제의 역과 대우",
    "10공수2-02-06": "충분·필요조건",
    "10공수2-02-07": "대우·귀류법",
    "10공수2-02-08": "절대부등식",
    "10공수2-03-01": "함수의 개념",
    "10공수2-03-02": "합성함수",
    "10공수2-03-03": "역함수",
    "10공수2-03-04": "유리함수",
    "10공수2-03-05": "무리함수",
}

# unit -> (school, grade) for filter metadata
UNIT_META = {
    **{f"MS1-{i:02d}": ("중학교", "1학년") for i in range(1, 7)},
    **{f"MS2-{i:02d}": ("중학교", "2학년") for i in range(1, 9)},
    **{f"MS3-{i:02d}": ("중학교", "3학년") for i in range(1, 11)},
    **{f"HS1-{i:02d}": ("고등학교", "1학년") for i in range(1, 7)},
}


def main() -> None:
    unit_topics: dict[str, set[str]] = {}
    topic_units: dict[str, str] = {}

    for file in DATA.glob("*/problem.json"):
        problem = json.loads(file.read_text(encoding="utf-8"))
        if problem.get("quality", {}).get("status") == "quarantined":
            continue
        units = problem.get("unit_codes") or []
        topics = problem.get("topic_codes") or []
        if not units:
            continue
        primary = units[0]
        for t in topics:
            topic_units.setdefault(t, primary)
            unit_topics.setdefault(primary, set()).add(t)

    unit_rows = []
    for code in sorted(UNIT_LABELS):
        if code not in unit_topics and code not in UNIT_META:
            continue
        school, grade = UNIT_META[code]
        unit_rows.append(
            {
                "code": code,
                "label": UNIT_LABELS[code],
                "school": school,
                "grade": grade,
            }
        )

    # Include units that appeared but aren't in labels (shouldn't happen)
    for code in sorted(unit_topics):
        if code not in UNIT_LABELS:
            school, grade = UNIT_META.get(code, ("중학교", "3학년"))
            unit_rows.append(
                {"code": code, "label": code, "school": school, "grade": grade}
            )

    topic_rows = []
    for code in sorted(topic_units):
        topic_rows.append(
            {
                "code": code,
                "label": TOPIC_LABELS.get(code, code),
                "unitCode": topic_units[code],
            }
        )

    # Also ensure every labeled topic that maps via prepare is present
    # even if rare / only in quarantined — skip for seed FK safety.

    ts = f"""/* eslint-disable */
/** Auto-generated by scripts/build_catalog.py — do not edit by hand. */

export const UNIT_ROWS = {json.dumps(unit_rows, ensure_ascii=False, indent=2)} as const;

export const TOPIC_ROWS = {json.dumps(topic_rows, ensure_ascii=False, indent=2)} as const;
"""
    OUT.write_text(ts, encoding="utf-8")
    print(
        json.dumps(
            {
                "units": len(unit_rows),
                "topics": len(topic_rows),
                "by_band": dict(
                    Counter(u["code"].split("-")[0] for u in unit_rows)
                ),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
