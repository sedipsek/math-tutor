#!/usr/bin/env python3
"""Curate AI Hub secondary (중·고) annotation defects without inventing content."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[1] / "datasets" / "aihub-secondary"

TEXT_FIXES: dict[tuple[str, str, int], str] = {
    ("S3_중등_3_012682", "answer_image", 0): "① $x^{2}+4x=0$ [-4]",
    ("S3_중등_3_012731", "answer_image", 0): "$\\sqrt{\\frac{9}{125}}=\\frac{x}{y^{3}}$",
    ("S3_중등_3_013177", "stem_text", 0): "$\\tan \\left(3x+15^{\\circ}\\right)=\\sqrt{3}$일 때, $\\cos 2x+\\sin 4x$의 값은? (단, $5^{\\circ}<x<20^{\\circ}$)",
    ("S3_중등_3_013724", "explanation_text", 0): "$(평균)=\\frac{1+3+0+2+4}{5}=\\frac{10}{5}=2$(개)",
    ("S3_중등_3_013842", "explanation_text", 0): "\\[ \\overline{\\mathrm{BD}}=\\sqrt{3^{2}+4^{2}}=\\sqrt{25}=5 \\] $\\triangle \\mathrm{ABD}$에서 $3\\times4=5\\times\\overline{\\mathrm{AE}}$이므로 $\\overline{\\mathrm{AE}}=\\frac{12}{5}$이다. $\\triangle \\mathrm{ABE}$에서 $\\overline{\\mathrm{BE}}=\\sqrt{3^{2}-\\left(\\frac{12}{5}\\right)^{2}}=\\frac{9}{5}$이다. $\\overline{\\mathrm{BE}}=\\overline{\\mathrm{DF}}$이므로 $\\overline{\\mathrm{EF}}=5-2\\overline{\\mathrm{BE}}=5-\\frac{18}{5}=\\frac{7}{5}$이다.",
    ("S3_중등_3_014133", "answer_image", 0): "② $\\sqrt{(-a)^{2}}=-a$",
    ("S3_중등_3_014317", "answer_image", 0): "$4x^{2}-4y^{2}=4(x-y)(x+y)$, $2x^{2}-xy-10y^{2}=(x+2y)(2x-5y)$",
    ("S3_중등_3_014737", "explanation_text", 0): "$\\square \\mathrm{ABCD}$가 원에 내접하므로 $\\angle \\mathrm{ADC}=\\angle x$이다. $\\square \\mathrm{BCDE}$가 원에 내접하므로 $78^{\\circ}+(20^{\\circ}+\\angle x)=180^{\\circ}$, 따라서 $\\angle x=82^{\\circ}$이다.",
    ("S3_중등_3_014817", "wrong_image", 2): "③ $\\square \\mathrm{ABCD}$에 $\\overline{\\mathrm{AC}}$가 그어져 있고, $\\angle \\mathrm{BAC}=60^{\\circ}$, $\\angle \\mathrm{ACB}=40^{\\circ}$, $\\angle \\mathrm{ADC}=100^{\\circ}$이다.",
    ("S3_중등_3_015248", "explanation_text", 0): "$-(\\sqrt{7})^{2}=7$: $(\\sqrt{7})^{2}=7$이므로 $-(\\sqrt{7})^{2}=-7$이다. 따라서 틀리다.",
    ("S3_중등_3_003302", "stem_text", 1): "② $(-\\sqrt{26})^{2}\\div\\sqrt{169}$",
    ("S3_중등_3_003313", "answer_text", 0): "$\\sqrt{14}$",
    ("S3_중등_3_003330", "stem_text", 1): "$\\sqrt{18}+\\sqrt{24}-\\sqrt{8}+\\sqrt{6}$",
    ("S3_중등_3_019599", "explanation_text", 0): "$\\overline{\\mathrm{AB}}:\\overline{\\mathrm{AC}}=5:4$이므로 $\\overline{\\mathrm{AB}}=5a$, $\\overline{\\mathrm{AC}}=4a$라 하면 $\\overline{\\mathrm{BC}}=\\sqrt{\\overline{\\mathrm{AB}}^{2}-\\overline{\\mathrm{AC}}^{2}}=\\sqrt{25a^{2}-16a^{2}}=3a$이다.",
}

TYPO_FIXES = {
    "비숫하고": "비슷하고",
    "고 르지": "고르지",
    "꼭지점": "꼭짓점",
}

JAMO_FIXES = str.maketrans({"ᄀ": "ㄱ", "ᄂ": "ㄴ", "ᄃ": "ㄷ", "ᄅ": "ㄹ"})


def odd_dollars(text: str) -> bool:
    return len(re.findall(r"(?<!\\)\$", text.replace("$$", ""))) % 2 == 1


def main() -> None:
    files = sorted((ROOT / "problems").glob("*/problem.json"))
    manifest = []
    issue_counts: Counter[str] = Counter()
    quarantined = []

    for file in files:
        problem = json.loads(file.read_text(encoding="utf-8"))
        pid = problem["id"]

        if pid == "S3_중등_3_003409":
            problem["question_type"] = "객관식"

        for crop in problem["crops"]:
            key = (pid, crop["slug"], crop["index"])
            if key in TEXT_FIXES:
                crop["text"] = TEXT_FIXES[key]
            text = crop.get("text") or ""
            for before, after in TYPO_FIXES.items():
                text = text.replace(before, after)
            crop["text"] = text.translate(JAMO_FIXES)

        kept = []
        for crop in problem["crops"]:
            if crop.get("path"):
                image_path = file.parent / crop["path"]
                if not image_path.exists():
                    crop["path"] = None
                else:
                    image = Image.open(image_path).convert("L")
                    if ImageStat.Stat(image).mean[0] > 254.5:
                        image_path.unlink(missing_ok=True)
                        continue
            kept.append(crop)
        problem["crops"] = kept

        has_wrong = any(
            c["slug"].startswith("wrong") and (c.get("text") or "").strip()
            for c in kept
        )
        has_explanation = any(
            c["slug"].startswith("explanation") and (c.get("text") or "").strip()
            for c in kept
        )
        issues = []
        if not problem.get("unit_codes"):
            issues.append("missing_unit")
        if problem["question_type"] == "객관식" and not has_wrong:
            issues.append("missing_choices")
        if not has_explanation:
            issues.append("missing_explanation")
        for crop in kept:
            if odd_dollars(crop.get("text") or ""):
                issues.append("broken_latex")
                break
        for issue in issues:
            issue_counts[issue] += 1
        # unique issues
        issues = list(dict.fromkeys(issues))
        status = "quarantined" if issues else "ready"
        problem["quality"] = {"status": status, "issues": issues}
        if issues:
            quarantined.append({"id": pid, "issues": issues})

        file.write_text(
            json.dumps(problem, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        stem_images = [
            c for c in kept if c["slug"] == "stem_image" and c.get("path")
        ]
        manifest.append(
            {
                "id": pid,
                "school": problem.get("school"),
                "grade": problem.get("grade"),
                "subject": problem.get("subject"),
                "question_type": problem["question_type"],
                "difficulty": problem["difficulty"],
                "semester": problem["semester"],
                "publisher": problem["publisher"],
                "unit_codes": problem["unit_codes"],
                "topic_codes": problem["topic_codes"],
                "n_stem_images": len(stem_images),
                "has_stem_image": bool(stem_images),
                "quality": problem["quality"],
                "path": f"problems/{pid}/problem.json",
            }
        )

    (ROOT / "manifest.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in manifest) + "\n",
        encoding="utf-8",
    )
    (ROOT / "quarantine.json").write_text(
        json.dumps(quarantined, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    ready = [r for r in manifest if r["quality"]["status"] == "ready"]
    stats = {
        "n_problems": len(manifest),
        "ready": len(ready),
        "quarantined": len(quarantined),
        "quality_issues": dict(issue_counts),
        "by_school": dict(Counter(r["school"] for r in ready)),
        "by_grade": dict(
            Counter(f"{r['school']}/{r['grade']}" for r in ready)
        ),
        "by_type": dict(Counter(r["question_type"] for r in ready)),
        "by_difficulty": dict(Counter(r["difficulty"] for r in ready)),
        "by_semester": dict(Counter(r["semester"] for r in ready)),
        "by_publisher": dict(Counter(r["publisher"] for r in ready)),
        "n_stem_images": sum(r["n_stem_images"] for r in ready),
        "problems_with_stem_image": sum(r["has_stem_image"] for r in ready),
        "problems_text_only": sum(not r["has_stem_image"] for r in ready),
    }
    (ROOT / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
