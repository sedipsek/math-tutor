import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { fail } from "./http.ts";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

export type AuthUser = {
  id: number;
  username: string;
  role: "student" | "admin";
};

export type AuthVariables = {
  user: AuthUser | null;
};

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    token,
    userId,
    expiresAt: sessionExpiry(),
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function loadUserFromToken(
  token: string | undefined,
): Promise<AuthUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);

  if (!row) {
    if (token) {
      await db
        .delete(sessions)
        .where(
          and(eq(sessions.token, token), lt(sessions.expiresAt, new Date())),
        );
    }
    return null;
  }

  return { id: row.id, username: row.username, role: row.role };
}

/** 요청마다 쿠키 세션을 읽어 c.set("user", …) */
export const attachUser: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = await loadUserFromToken(token);
  c.set("user", user);
  await next();
};

export async function requireAuth(
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) {
  const user = c.get("user");
  if (!user) {
    return fail(c, 401, "unauthorized", "로그인이 필요해요");
  }
  await next();
}

export async function requireAdmin(
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) {
  const user = c.get("user");
  if (!user) {
    return fail(c, 401, "unauthorized", "로그인이 필요해요");
  }
  if (user.role !== "admin") {
    return fail(c, 403, "forbidden", "관리자만 이용할 수 있어요");
  }
  await next();
}

/**
 * 어드민 시드 (서버 기동 시).
 * ADMIN_USERNAME + ADMIN_PASSWORD 가 있을 때만 생성/승격.
 * 비밀번호는 코드에 넣지 않는다.
 */
export async function ensureAdminSeed(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.log(
      "[seed] ADMIN_USERNAME / ADMIN_PASSWORD 없음 — 어드민 시드 건너뜀",
    );
    return;
  }

  const { hashPassword } = await import("./password.ts");
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing) {
    const passwordHash = await hashPassword(password);
    await db
      .update(users)
      .set({ role: "admin", passwordHash })
      .where(eq(users.id, existing.id));
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    username,
    passwordHash,
    role: "admin",
  });
  console.log(`[seed] admin user "${username}" created`);
}
