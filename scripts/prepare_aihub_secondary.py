#!/usr/bin/env python3
"""AI Hub 71859 중·고: bbox 크롭 + 문제 단위 정리본 생성."""

from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "datasets" / "aihub-71859" / "extracted"
OUT = ROOT / "datasets" / "aihub-secondary"

# (label_dir, image_dir, fallback_qtype)
PAIRS = [
    ("TL_05.중학교_1학년_01.객관식", "TS_05.중학교_1학년_01.객관식", "객관식"),
    ("TL_05.중학교_1학년_02.주관식", "TS_05.중학교_1학년_02.주관식", "주관식"),
    ("TL_06.중학교_2학년_01.객관식", "TS_06.중학교_2학년_01.객관식", "객관식"),
    ("TL_06.중학교_2학년_02.주관식", "TS_06.중학교_2학년_02.주관식", "주관식"),
    ("TL_07.중학교_3학년_01.객관식", "TS_07.중학교_3학년_01.객관식", "객관식"),
    ("TL_07.중학교_3학년_02.주관식", "TS_07.중학교_3학년_02.주관식", "주관식"),
    ("TL_08.고등학교_1학년_01.객관식", "TS_08.고등학교_1학년_01.객관식", "객관식"),
    ("TL_08.고등학교_1학년_02.주관식", "TS_08.고등학교_1학년_02.주관식", "주관식"),
    ("VL_05.중학교_1학년_01.객관식", "VS_05.중학교_1학년_01.객관식", "객관식"),
    ("VL_05.중학교_1학년_02.주관식", "VS_05.중학교_1학년_02.주관식", "주관식"),
    ("VL_06.중학교_2학년_01.객관식", "VS_06.중학교_2학년_01.객관식", "객관식"),
    ("VL_06.중학교_2학년_02.주관식", "VS_06.중학교_2학년_02.주관식", "주관식"),
    ("VL_07.중학교_3학년_01.객관식", "VS_07.중학교_3학년_01.객관식", "객관식"),
    ("VL_07.중학교_3학년_02.주관식", "VS_07.중학교_3학년_02.주관식", "주관식"),
    ("VL_08.고등학교_1학년_01.객관식", "VS_08.고등학교_1학년_01.객관식", "객관식"),
    ("VL_08.고등학교_1학년_02.주관식", "VS_08.고등학교_1학년_02.주관식", "주관식"),
]

CLASS_SLUG = {
    "문항(텍스트)": "stem_text",
    "문항(이미지)": "stem_image",
    "정답(텍스트)": "answer_text",
    "정답(이미지)": "answer_image",
    "오답(텍스트)": "wrong_text",
    "오답(이미지)": "wrong_image",
    "해설(텍스트)": "explanation_text",
    "해설(이미지)": "explanation_image",
}

# Extract codes inside [...] e.g. 9수01-07, 10공수1-02-01
CODE_RE = re.compile(r"\[([^\[\]]+)\]")

# topic -> unit within a grade band (MS1/MS2/MS3/HS1)
UNIT_BY_TOPIC: dict[str, dict[str, str]] = {
    "MS1": {
        "9수01-01": "MS1-01",
        "9수01-02": "MS1-01",
        "9수01-03": "MS1-01",
        "9수01-04": "MS1-01",
        "9수01-05": "MS1-01",
        "9수02-01": "MS1-02",
        "9수02-02": "MS1-02",
        "9수02-03": "MS1-02",
        "9수02-04": "MS1-02",
        "9수02-05": "MS1-03",
        "9수02-06": "MS1-03",
        "9수02-07": "MS1-03",
        "9수03-01": "MS1-04",
        "9수03-02": "MS1-04",
        "9수03-03": "MS1-04",
        "9수03-04": "MS1-04",
        "9수03-05": "MS1-04",
        "9수03-06": "MS1-05",
        "9수03-07": "MS1-05",
        "9수03-08": "MS1-05",
        "9수04-02": "MS1-06",
        "9수04-03": "MS1-06",
    },
    "MS2": {
        "9수01-06": "MS2-01",
        "9수02-08": "MS2-02",
        "9수02-09": "MS2-02",
        "9수02-10": "MS2-02",
        "9수02-11": "MS2-03",
        "9수02-12": "MS2-03",
        "9수02-13": "MS2-03",
        "9수02-14": "MS2-04",
        "9수02-15": "MS2-04",
        "9수02-16": "MS2-04",
        "9수02-17": "MS2-04",
        "9수02-18": "MS2-04",
        "9수03-09": "MS2-05",
        "9수03-10": "MS2-05",
        "9수03-11": "MS2-05",
        "9수03-12": "MS2-06",
        "9수03-13": "MS2-06",
        "9수03-14": "MS2-06",
        "9수03-15": "MS2-07",
        "9수04-05": "MS2-08",
        "9수04-06": "MS2-08",
    },
    "MS3": {
        "9수01-07": "MS3-01",
        "9수01-08": "MS3-01",
        "9수01-09": "MS3-01",
        "9수01-10": "MS3-01",
        "9수02-19": "MS3-02",
        "9수02-20": "MS3-03",
        "9수02-21": "MS3-04",
        "9수02-22": "MS3-04",
        "9수03-15": "MS3-05",
        "9수03-16": "MS3-06",
        "9수03-17": "MS3-06",
        "9수03-18": "MS3-07",
        "9수03-19": "MS3-07",
        "9수04-01": "MS3-08",
        "9수04-07": "MS3-09",
        "9수04-09": "MS3-10",
    },
    "HS1": {
        "10공수1-01-01": "HS1-01",
        "10공수1-01-02": "HS1-01",
        "10공수1-01-03": "HS1-01",
        "10공수1-02-01": "HS1-02",
        "10공수1-02-02": "HS1-02",
        "10공수1-02-03": "HS1-02",
        "10공수1-02-04": "HS1-02",
        "10공수1-02-05": "HS1-02",
        "10공수1-02-06": "HS1-02",
        "10공수1-02-07": "HS1-02",
        "10공수1-02-08": "HS1-02",
        "10공수1-02-09": "HS1-02",
        "10공수1-02-10": "HS1-02",
        "10공수1-02-11": "HS1-02",
        "10공수1-03-01": "HS1-03",
        "10공수1-03-02": "HS1-03",
        "10공수1-03-03": "HS1-03",
        "10공수2-01-01": "HS1-04",
        "10공수2-01-02": "HS1-04",
        "10공수2-01-03": "HS1-04",
        "10공수2-01-04": "HS1-04",
        "10공수2-01-05": "HS1-04",
        "10공수2-01-06": "HS1-04",
        "10공수2-01-07": "HS1-04",
        "10공수2-02-01": "HS1-05",
        "10공수2-02-02": "HS1-05",
        "10공수2-02-03": "HS1-05",
        "10공수2-02-04": "HS1-05",
        "10공수2-02-05": "HS1-05",
        "10공수2-02-06": "HS1-05",
        "10공수2-02-07": "HS1-05",
        "10공수2-02-08": "HS1-05",
        "10공수2-03-01": "HS1-06",
        "10공수2-03-02": "HS1-06",
        "10공수2-03-03": "HS1-06",
        "10공수2-03-04": "HS1-06",
        "10공수2-03-05": "HS1-06",
    },
}


def grade_band(school: str, grade: str) -> str:
    if school == "고등학교":
        return "HS1"
    if grade == "1학년":
        return "MS1"
    if grade == "2학년":
        return "MS2"
    if grade == "3학년":
        return "MS3"
    raise ValueError(f"unsupported grade: {school}/{grade}")


def region_to_box(type_name: str, type_value) -> list[float] | None:
    if not type_value:
        return None
    if type_name == "Bounding_Box":
        box = type_value[0] if isinstance(type_value[0], (list, tuple)) else type_value
        if len(box) >= 4:
            return [float(box[0]), float(box[1]), float(box[2]), float(box[3])]
        return None
    if type_name == "Polygon":
        xs = [float(p[0]) for p in type_value if len(p) >= 2]
        ys = [float(p[1]) for p in type_value if len(p) >= 2]
        if not xs or not ys:
            return None
        return [min(xs), min(ys), max(xs), max(ys)]
    return None


def clamp_box(box: list[float], w: int, h: int) -> tuple[int, int, int, int] | None:
    x1, y1, x2, y2 = box
    left = max(0, min(int(x1), w - 1))
    top = max(0, min(int(y1), h - 1))
    right = max(0, min(int(x2), w))
    bottom = max(0, min(int(y2), h))
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def topic_codes(standards: list) -> list[str]:
    out: list[str] = []
    for s in standards or []:
        out.extend(CODE_RE.findall(str(s)))
    seen: set[str] = set()
    uniq: list[str] = []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def unit_codes_for(band: str, topics: list[str]) -> list[str]:
    mapping = UNIT_BY_TOPIC[band]
    units: list[str] = []
    for t in topics:
        u = mapping.get(t)
        if u and u not in units:
            units.append(u)
    return units


def process_one(json_path: Path, png_path: Path, qtype_folder: str) -> dict:
    raw = json.loads(json_path.read_text(encoding="utf-8"))
    src = raw["source_data_info"]
    meta = raw["raw_data_info"]
    pid = src["source_data_name"]

    school = meta.get("school") or ""
    grade = meta.get("grade") or ""
    subject = meta.get("subject") or "수학"
    band = grade_band(school, grade)

    problem_dir = OUT / "problems" / pid
    crops_dir = problem_dir / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    im = Image.open(png_path).convert("RGB")
    w, h = im.size

    crops: list[dict] = []
    counters: Counter[str] = Counter()

    for block in raw.get("learning_data_info") or []:
        class_name = block["class_name"]
        slug = CLASS_SLUG.get(class_name, re.sub(r"[^\w]+", "_", class_name))
        for info in block.get("class_info_list") or []:
            type_name = info.get("Type") or "Bounding_Box"
            box = region_to_box(type_name, info.get("Type_value"))
            clipped = clamp_box(box, w, h) if box else None
            idx = counters[slug]
            counters[slug] += 1
            rel = None
            if clipped and slug == "stem_image":
                rel = f"crops/{slug}_{idx}.png"
                im.crop(clipped).save(problem_dir / rel, format="PNG", optimize=True)
            crops.append(
                {
                    "slug": slug,
                    "index": idx,
                    "path": rel,
                    "text": info.get("text_description") or "",
                }
            )

    topics = topic_codes(src.get("2022_achievement_standard"))
    units = unit_codes_for(band, topics)

    problem = {
        "id": pid,
        "school": school,
        "grade": grade,
        "subject": subject,
        "question_type": src.get("types_of_problems") or qtype_folder,
        "semester": meta.get("semester"),
        "difficulty": src.get("level_of_difficulty"),
        "topic_codes": topics,
        "unit_codes": units,
        "date": meta.get("date"),
        "publisher": meta.get("publisher"),
        "publication_year": meta.get("publication_year"),
        "revision_year": meta.get("revision_year"),
        "crops": crops,
    }

    (problem_dir / "problem.json").write_text(
        json.dumps(problem, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "id": pid,
        "school": school,
        "grade": grade,
        "subject": subject,
        "question_type": problem["question_type"],
        "difficulty": problem["difficulty"],
        "semester": problem["semester"],
        "publisher": problem["publisher"],
        "unit_codes": units,
        "topic_codes": topics,
        "n_stem_images": sum(1 for c in crops if c["path"]),
        "has_stem_image": any(c["path"] for c in crops),
        "path": f"problems/{pid}/problem.json",
    }


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source: {SRC}")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    manifest: list[dict] = []
    errors: list[str] = []

    for label_dir, image_dir, qtype in PAIRS:
        ldir = SRC / label_dir
        idir = SRC / image_dir
        if not ldir.exists() or not idir.exists():
            errors.append(f"missing dirs: {label_dir} / {image_dir}")
            continue

        labels = {p.stem: p for p in ldir.rglob("*.json")}
        images = {p.stem: p for p in idir.rglob("*.png")}
        common = sorted(set(labels) & set(images))
        missing_img = set(labels) - set(images)
        missing_lbl = set(images) - set(labels)
        if missing_img:
            errors.append(f"{label_dir}: {len(missing_img)} json without png")
        if missing_lbl:
            errors.append(f"{image_dir}: {len(missing_lbl)} png without json")

        for stem in common:
            try:
                row = process_one(labels[stem], images[stem], qtype)
                manifest.append(row)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{stem}: {e}")

    manifest.sort(key=lambda r: r["id"])
    (OUT / "manifest.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in manifest) + "\n",
        encoding="utf-8",
    )

    stats = {
        "n_problems": len(manifest),
        "by_school": dict(Counter(r["school"] for r in manifest)),
        "by_grade": dict(
            Counter(f"{r['school']}/{r['grade']}" for r in manifest)
        ),
        "by_type": dict(Counter(r["question_type"] for r in manifest)),
        "by_difficulty": dict(Counter(r["difficulty"] for r in manifest)),
        "by_semester": dict(Counter(r["semester"] for r in manifest)),
        "by_publisher": dict(Counter(r.get("publisher") for r in manifest)),
        "n_stem_images": sum(r["n_stem_images"] for r in manifest),
        "problems_with_stem_image": sum(1 for r in manifest if r["has_stem_image"]),
        "problems_text_only": sum(1 for r in manifest if not r["has_stem_image"]),
        "missing_unit": sum(1 for r in manifest if not r["unit_codes"]),
        "errors": errors,
    }
    (OUT / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
