import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { attachUser, ensureAdminSeed, type AuthVariables } from "./lib/auth.ts";
import { fail } from "./lib/http.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { generatedRoutes } from "./routes/generated.ts";
import { metaRoutes } from "./routes/meta.ts";
import { problemRoutes } from "./routes/problems.ts";

const app = new Hono<{ Variables: AuthVariables }>();

app.use(logger());
app.use("*", attachUser);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", metaRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/problems", problemRoutes);
app.route("/api/generated", generatedRoutes);
app.route("/api/admin", adminRoutes);

app.notFound((c) => fail(c, 404, "not_found", "없는 경로"));
app.onError((err, c) => {
  console.error(err);
  return fail(c, 500, "internal", "서버 오류");
});

const port = Number(process.env.PORT ?? 3001);

await ensureAdminSeed();

serve({ fetch: app.fetch, port }, () => {
  console.log(`api http://localhost:${port}`);
});
