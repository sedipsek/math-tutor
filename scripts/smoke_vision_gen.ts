import { generateSimilarProblem, type SourceContext } from "../server/lib/generate.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";

const id = "S3_고등_1_006431";
const rel = "crops/stem_image_0.png";
const abs = path.resolve("datasets/aihub-secondary/problems", id, rel);

const source: SourceContext = {
  id,
  school: "고등학교",
  grade: "1학년",
  subject: "수학",
  questionType: "객관식",
  difficulty: "중",
  semester: "1학기",
  unitCode: "HS1-04",
  unitLabel: "도형의 방정식",
  topics: [],
  content: {
    stem: { texts: ["(원본 stem 생략 — 이미지 참고)"], images: [] },
    choices: null,
    answer: { texts: [] },
    explanation: { texts: [] },
  },
  hasStemImage: true,
  stemImages: [{ absPath: abs, relPath: rel }],
};

async function main() {
  console.log("env", {
    vision: process.env.LLM_VISION_MODEL,
    max: process.env.LLM_VISION_MAX_TOKENS,
  });
  await readFile(abs);
  const t0 = Date.now();
  try {
    const out = await generateSimilarProblem(source);
    console.log("ok", Date.now() - t0, "ms");
    console.log({
      model: out.model,
      stemImagePath: out.stemImagePath,
      stem: out.stem.slice(0, 120),
      choices: out.choices?.length,
    });
  } catch (e) {
    console.error("fail", Date.now() - t0, "ms", e);
    process.exit(1);
  }
}

main();
