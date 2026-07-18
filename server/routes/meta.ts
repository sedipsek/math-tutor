import { Hono } from "hono";
import { and, asc, count, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "../db/client.ts";
import { problems, problemTopics, topics, units } from "../db/schema.ts";

export const metaRoutes = new Hono();

const DIFFICULTY_ORDER = ["하", "중", "상"] as const;
const SEMESTER_ORDER = ["1학기", "2학기", "공통"] as const;
const TYPE_ORDER = ["객관식", "주관식"] as const;
const SCHOOL_ORDER = ["중학교", "고등학교"] as const;

function orderedCounts<T extends string>(
  order: readonly T[],
  rows: Array<{ value: T; count: number }>,
) {
  const map = new Map(rows.map((r) => [r.value, r.count]));
  return order.map((value) => ({ value, count: map.get(value) ?? 0 }));
}

function csv(raw: string | undefined) {
  return raw
    ? [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))]
    : [];
}

/**
 * 필터 UI가 한 번에 그릴 수 있도록 단원/토픽/분포를 모두 반환.
 * school / grade 쿼리로 단원 목록을 좁힐 수 있다.
 */
metaRoutes.get("/meta", async (c) => {
  const schools = csv(c.req.query("school"));
  const grades = csv(c.req.query("grade"));

  const unitConditions: SQL[] = [];
  if (schools.length) unitConditions.push(inArray(units.school, schools));
  if (grades.length) unitConditions.push(inArray(units.grade, grades));
  const unitWhere = unitConditions.length ? and(...unitConditions) : undefined;

  const unitQuery = db
    .select({
      code: units.code,
      label: units.label,
      school: units.school,
      grade: units.grade,
      count: count(problems.id),
    })
    .from(units)
    .leftJoin(problems, eq(problems.unitCode, units.code))
    .$dynamic();

  const [
    unitRows,
    topicRows,
    schoolRows,
    gradeRows,
    subjectRows,
    difficultyRows,
    semesterRows,
    typeRows,
    totalRow,
  ] = await Promise.all([
    (unitWhere ? unitQuery.where(unitWhere) : unitQuery)
      .groupBy(units.code, units.label, units.school, units.grade)
      .orderBy(asc(units.code)),
    db
      .select({
        code: topics.code,
        label: topics.label,
        unitCode: topics.unitCode,
        count: count(problemTopics.problemId),
      })
      .from(topics)
      .leftJoin(problemTopics, eq(problemTopics.topicCode, topics.code))
      .groupBy(topics.code, topics.label, topics.unitCode)
      .orderBy(asc(topics.code)),
    db
      .select({ value: problems.school, count: count() })
      .from(problems)
      .groupBy(problems.school),
    db
      .select({
        school: problems.school,
        value: problems.grade,
        count: count(),
      })
      .from(problems)
      .groupBy(problems.school, problems.grade)
      .orderBy(asc(problems.school), asc(problems.grade)),
    db
      .select({ value: problems.subject, count: count() })
      .from(problems)
      .groupBy(problems.subject)
      .orderBy(asc(problems.subject)),
    db
      .select({ value: problems.difficulty, count: count() })
      .from(problems)
      .groupBy(problems.difficulty),
    db
      .select({ value: problems.semester, count: count() })
      .from(problems)
      .groupBy(problems.semester),
    db
      .select({ value: problems.questionType, count: count() })
      .from(problems)
      .groupBy(problems.questionType),
    db.select({ total: count() }).from(problems),
  ]);

  return c.json({
    total: totalRow[0]?.total ?? 0,
    schools: orderedCounts(
      SCHOOL_ORDER,
      schoolRows as Array<{ value: (typeof SCHOOL_ORDER)[number]; count: number }>,
    ),
    grades: gradeRows,
    subjects: subjectRows,
    units: unitRows,
    topics: topicRows,
    difficulties: orderedCounts(DIFFICULTY_ORDER, difficultyRows),
    semesters: orderedCounts(SEMESTER_ORDER, semesterRows),
    questionTypes: orderedCounts(TYPE_ORDER, typeRows),
  });
});
