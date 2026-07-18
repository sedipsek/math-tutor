import { sql } from "drizzle-orm";
import { UNIT_ROWS, TOPIC_ROWS } from "./catalog.generated.ts";
import { db } from "./client.ts";
import { topics, units } from "./schema.ts";

export { UNIT_ROWS, TOPIC_ROWS };

export async function seedCatalog() {
  await db
    .insert(units)
    .values([...UNIT_ROWS])
    .onConflictDoUpdate({
      target: units.code,
      set: {
        label: sql`excluded.label`,
        school: sql`excluded.school`,
        grade: sql`excluded.grade`,
      },
    });

  await db
    .insert(topics)
    .values([...TOPIC_ROWS])
    .onConflictDoUpdate({
      target: topics.code,
      set: {
        label: sql`excluded.label`,
        unitCode: sql`excluded.unit_code`,
      },
    });

  return { units: UNIT_ROWS.length, topics: TOPIC_ROWS.length };
}
