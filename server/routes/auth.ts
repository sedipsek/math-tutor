import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
  type AuthVariables,
} from "../lib/auth.ts";
import { fail } from "../lib/http.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import { rateLimit } from "../lib/rateLimit.ts";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** 로그인/가입: IP당 10분 20회 */
const authLimit = rateLimit({ name: "auth", limit: 20, windowMs: 10 * 60_000 });

function publicUser(u: { id: number; username: string; role: string }) {
  return {
    id: u.id,
    username: u.username,
    role: u.role as "student" | "admin",
  };
}

authRoutes.get("/me", (c) => {
  return c.json({ user: c.get("user") });
});

authRoutes.post("/signup", authLimit, async (c) => {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "bad_body", "JSON 본문 필요");
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!USERNAME_RE.test(username)) {
    return fail(
      c,
      400,
      "bad_username",
      "아이디는 영문·숫자·밑줄 3~20자여야 해요",
    );
  }
  if (password.length < 8) {
    return fail(c, 400, "bad_password", "비밀번호는 8자 이상이어야 해요");
  }

  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (dup) {
    return fail(c, 409, "username_taken", "이미 사용 중인 아이디예요");
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(users)
    .values({ username, passwordHash, role: "student" })
    .returning();

  const token = await createSession(created!.id);
  setSessionCookie(c, token);
  return c.json({ user: publicUser(created!) }, 201);
});

authRoutes.post("/login", authLimit, async (c) => {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "bad_body", "JSON 본문 필요");
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return fail(c, 400, "bad_body", "아이디와 비밀번호를 입력해 주세요");
  }

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!row || !(await verifyPassword(password, row.passwordHash))) {
    return fail(
      c,
      401,
      "bad_credentials",
      "아이디 또는 비밀번호가 올바르지 않아요",
    );
  }

  const token = await createSession(row.id);
  setSessionCookie(c, token);
  return c.json({ user: publicUser(row) });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
