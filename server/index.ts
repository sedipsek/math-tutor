import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
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
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const serveWeb = existsSync(path.join(distDir, "index.html"));

app.use(logger());
app.use("*", attachUser);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", metaRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/problems", problemRoutes);
app.route("/api/generated", generatedRoutes);
app.route("/api/admin", adminRoutes);

if (serveWeb) {
  app.use(
    "*",
    serveStatic({
      root: "./dist",
      rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
    }),
  );
  app.get("*", serveStatic({ root: "./dist", path: "index.html" }));
}

app.notFound((c) => {
  if (c.req.path.startsWith("/api")) {
    return fail(c, 404, "not_found", "없는 경로");
  }
  return fail(c, 404, "not_found", "없는 경로");
});
app.onError((err, c) => {
  console.error(err);
  return fail(c, 500, "internal", "서버 오류");
});

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "0.0.0.0";

await ensureAdminSeed();

serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`api http://${hostname}:${port}${serveWeb ? " (+ web)" : ""}`);
});
