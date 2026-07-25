import type {
  AlternateExplanation,
  AuthUser,
  Filters,
  GeneratedList,
  Meta,
  Pool,
  ProblemDetail,
  ProblemList,
} from "./types";

async function parseError(res: Response): Promise<string> {
  let message = `요청 실패 (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* 본문 없는 오류 */
  }
  return message;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: "include" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
}

async function sendJson<T>(
  url: string,
  method: "POST" | "DELETE",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
}

export function filterParams(
  filters: Filters,
  pool?: Pool,
): URLSearchParams {
  const params = new URLSearchParams();
  if (pool) params.set("pool", pool);
  if (filters.schools.length) params.set("school", filters.schools.join(","));
  if (filters.grades.length) params.set("grade", filters.grades.join(","));
  if (filters.subjects.length) {
    params.set("subject", filters.subjects.join(","));
  }
  if (filters.units.length) params.set("unit", filters.units.join(","));
  if (filters.topics.length) params.set("topic", filters.topics.join(","));
  if (filters.difficulties.length) {
    params.set("difficulty", filters.difficulties.join(","));
  }
  if (filters.semesters.length) {
    params.set("semester", filters.semesters.join(","));
  }
  if (filters.questionTypes.length) {
    params.set("type", filters.questionTypes.join(","));
  }
  if (filters.hasImage) params.set("hasImage", "true");
  if (filters.q) params.set("q", filters.q);
  return params;
}

export function fetchMeta(signal?: AbortSignal) {
  return getJson<Meta>("/api/meta", signal);
}

export function fetchProblems(
  filters: Filters,
  limit: number,
  offset: number,
  pool: Pool = "all",
  signal?: AbortSignal,
) {
  const params = filterParams(filters, pool);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return getJson<ProblemList>(`/api/problems?${params}`, signal);
}

export function fetchProblem(id: string, signal?: AbortSignal) {
  return getJson<ProblemDetail>(
    `/api/problems/${encodeURIComponent(id)}`,
    signal,
  );
}

export function fetchRandom(
  filters: Filters,
  excludeIds: string[],
  pool: Pool = "all",
  signal?: AbortSignal,
) {
  const params = filterParams(filters, pool);
  if (excludeIds.length) params.set("exclude", excludeIds.join(","));
  return getJson<{ matched: number; problem: ProblemDetail }>(
    `/api/problems/random?${params}`,
    signal,
  );
}

export function generateSimilar(id: string, signal?: AbortSignal) {
  return sendJson<ProblemDetail>(
    `/api/problems/${encodeURIComponent(id)}/similar`,
    "POST",
    undefined,
    signal,
  );
}

export function fetchGeneratedBySource(sourceId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ source: sourceId });
  return getJson<GeneratedList>(`/api/generated?${params}`, signal);
}

export function fetchGenerated(id: string, signal?: AbortSignal) {
  return getJson<ProblemDetail>(
    `/api/generated/${encodeURIComponent(id)}`,
    signal,
  );
}

export function deleteGenerated(id: string, signal?: AbortSignal) {
  return sendJson<{ ok: boolean; id: string }>(
    `/api/generated/${encodeURIComponent(id)}`,
    "DELETE",
    undefined,
    signal,
  );
}

export function fetchMe(signal?: AbortSignal) {
  return getJson<{ user: AuthUser | null }>("/api/auth/me", signal);
}

export function login(username: string, password: string) {
  return sendJson<{ user: AuthUser }>("/api/auth/login", "POST", {
    username,
    password,
  });
}

export function signup(username: string, password: string) {
  return sendJson<{ user: AuthUser }>("/api/auth/signup", "POST", {
    username,
    password,
  });
}

export function logout() {
  return sendJson<{ ok: boolean }>("/api/auth/logout", "POST");
}

export type AdminGenerateBody = {
  school: string;
  grade: string;
  unitCode: string;
  topicCode?: string;
  difficulty: "상" | "중" | "하";
  questionType: "객관식" | "주관식";
  count: number;
};

export function adminGenerate(body: AdminGenerateBody, signal?: AbortSignal) {
  return sendJson<{ items: ProblemDetail[] }>(
    "/api/admin/generate",
    "POST",
    body,
    signal,
  );
}

export type GenerateStage = "refs" | "llm" | "validate" | "save" | "retry";

export type AnswerFeedbackBody = {
  correct: boolean;
  userAnswer: string;
  choiceMarker?: string;
};

export type AnswerFeedbackResult = {
  guess: string;
  tip: string;
  model?: string;
  cached?: boolean;
};

export type GenerateStreamHandlers = {
  onStage?: (info: {
    stage: GenerateStage;
    index?: number;
    total?: number;
    attempt?: number;
  }) => void;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onItem?: (problem: ProblemDetail) => void;
  onExplanation?: (explanation: AlternateExplanation) => void;
  onFeedback?: (feedback: AnswerFeedbackResult) => void;
  onDone?: (count: number) => void;
  onError?: (message: string) => void;
};

async function readSseStream(
  res: Response,
  handlers: GenerateStreamHandlers,
): Promise<void> {
  if (!res.body) throw new Error("스트림 본문이 없어요");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (!dataLines.length) {
      eventName = "message";
      return;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    const name = eventName;
    eventName = "message";

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (name === "stage") {
      handlers.onStage?.({
        stage: payload.stage as GenerateStage,
        index: typeof payload.index === "number" ? payload.index : undefined,
        total: typeof payload.total === "number" ? payload.total : undefined,
        attempt:
          typeof payload.attempt === "number" ? payload.attempt : undefined,
      });
      return;
    }
    if (name === "delta" && typeof payload.text === "string") {
      handlers.onDelta?.(payload.text);
      return;
    }
    if (name === "reasoning" && typeof payload.text === "string") {
      handlers.onReasoning?.(payload.text);
      return;
    }
    if (name === "item" && payload.problem) {
      handlers.onItem?.(payload.problem as ProblemDetail);
      return;
    }
    if (name === "item" && payload.explanation) {
      handlers.onExplanation?.(payload.explanation as AlternateExplanation);
      return;
    }
    if (name === "item" && payload.feedback) {
      const fb = payload.feedback as AnswerFeedbackResult;
      handlers.onFeedback?.({
        ...fb,
        cached:
          typeof payload.cached === "boolean" ? payload.cached : fb.cached,
      });
      return;
    }
    if (name === "done") {
      handlers.onDone?.(
        typeof payload.count === "number" ? payload.count : 0,
      );
      return;
    }
    if (name === "error") {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : "생성 중 오류가 났어요";
      handlers.onError?.(message);
      throw new Error(message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (!line) {
        dispatch();
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  dispatch();
}

async function postSse(
  url: string,
  body: unknown | undefined,
  handlers: GenerateStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  await readSseStream(res, handlers);
}

export function streamAdminGenerate(
  body: AdminGenerateBody,
  handlers: GenerateStreamHandlers,
  signal?: AbortSignal,
) {
  return postSse("/api/admin/generate/stream", body, handlers, signal);
}

export function streamGenerateSimilar(
  id: string,
  handlers: GenerateStreamHandlers,
  signal?: AbortSignal,
) {
  return postSse(
    `/api/problems/${encodeURIComponent(id)}/similar/stream`,
    undefined,
    handlers,
    signal,
  );
}

export function fetchExplanations(id: string, signal?: AbortSignal) {
  return getJson<{ items: AlternateExplanation[] }>(
    `/api/problems/${encodeURIComponent(id)}/explanations`,
    signal,
  );
}

export function streamGenerateExplanations(
  id: string,
  handlers: GenerateStreamHandlers,
  signal?: AbortSignal,
) {
  return postSse(
    `/api/problems/${encodeURIComponent(id)}/explanations/stream`,
    undefined,
    handlers,
    signal,
  );
}

export function requestAnswerFeedback(
  id: string,
  body: AnswerFeedbackBody,
  signal?: AbortSignal,
) {
  return sendJson<AnswerFeedbackResult>(
    `/api/problems/${encodeURIComponent(id)}/feedback`,
    "POST",
    body,
    signal,
  );
}

export function streamAnswerFeedback(
  id: string,
  body: AnswerFeedbackBody,
  handlers: GenerateStreamHandlers,
  signal?: AbortSignal,
) {
  return postSse(
    `/api/problems/${encodeURIComponent(id)}/feedback/stream`,
    body,
    handlers,
    signal,
  );
}

export function fetchAdminGenerated(
  limit: number,
  offset: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return getJson<GeneratedList>(`/api/admin/generated?${params}`, signal);
}
