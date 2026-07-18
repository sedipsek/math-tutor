/**
 * Team Wicked OpenAI-compatible chat completions.
 * - text: LLM_MODEL (glm5.2), max_tokens=LLM_MAX_TOKENS
 * - vision: LLM_VISION_MODEL (kimiK2.7code), max_tokens=LLM_VISION_MAX_TOKENS
 * temperature 미지정
 */

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export type LlmMode = "text" | "vision";

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string; type?: string } | string;
};

type StreamChunk = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string; type?: string } | string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new LlmError(`${name} 환경변수가 없음`);
  return value;
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return /aborted|AbortError/i.test(err.message);
}

function resolveRequest(mode: LlmMode) {
  const baseUrl = requireEnv("LLM_BASE_URL").replace(/\/$/, "");
  const apiKey = requireEnv("LLM_API_KEY");
  const model =
    mode === "vision"
      ? requireEnv("LLM_VISION_MODEL")
      : requireEnv("LLM_MODEL");

  // kimi 비전에 131071을 주면 응답이 안 오는 경우가 있어 별도 상한
  const maxTokens =
    mode === "vision"
      ? Number(process.env.LLM_VISION_MAX_TOKENS ?? "8192")
      : Number(process.env.LLM_MAX_TOKENS ?? "131071");
  const fallbackMax = mode === "vision" ? 8192 : 131071;
  const timeoutMs = mode === "vision" ? 300_000 : 180_000;

  return {
    baseUrl,
    apiKey,
    model,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : fallbackMax,
    timeoutMs,
  };
}

function errorMessage(
  err: { message?: string; type?: string } | string | undefined,
  fallback: string,
): string {
  if (typeof err === "string") return err;
  return err?.message ?? fallback;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: { mode?: LlmMode; signal?: AbortSignal } = {},
): Promise<{ content: string; model: string }> {
  const mode = options.mode ?? "text";
  const { baseUrl, apiKey, model, maxTokens, timeoutMs } =
    resolveRequest(mode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    const raw = (await res.json()) as ChatCompletionResponse;
    if (!res.ok) {
      const msg = errorMessage(raw.error, `LLM 요청 실패 (${res.status})`);
      // 업스트림이 타임아웃을 500 + aborted 메시지로 돌려주는 경우가 있음
      const status =
        /aborted|timeout|시간/i.test(msg) && res.status >= 500
          ? 504
          : res.status;
      throw new LlmError(msg, status);
    }

    const content = raw.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      throw new LlmError("LLM 응답 content가 비어 있음");
    }

    return { content, model: raw.model ?? model };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (isAbortError(err)) {
      throw new LlmError(
        `LLM 요청 시간 초과 (${Math.round(timeoutMs / 1000)}초)`,
      );
    }
    throw new LlmError(
      err instanceof Error ? err.message : "LLM 요청 실패",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export type ChatStreamOptions = {
  mode?: LlmMode;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
};

/** OpenAI-style SSE stream. Accumulates content and forwards token deltas. */
export async function chatCompletionStream(
  messages: ChatMessage[],
  options: ChatStreamOptions = {},
): Promise<{ content: string; model: string }> {
  const mode = options.mode ?? "text";
  const { baseUrl, apiKey, model, maxTokens, timeoutMs } =
    resolveRequest(mode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let msg = `LLM 요청 실패 (${res.status})`;
      try {
        const raw = (await res.json()) as ChatCompletionResponse;
        msg = errorMessage(raw.error, msg);
      } catch {
        try {
          msg = (await res.text()) || msg;
        } catch {
          /* ignore */
        }
      }
      const status =
        /aborted|timeout|시간/i.test(msg) && res.status >= 500
          ? 504
          : res.status;
      throw new LlmError(msg, status);
    }

    if (!res.body) {
      throw new LlmError("LLM 스트림 본문이 없음");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let resolvedModel = model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trimStart();
        if (data === "[DONE]") {
          buffer = "";
          break;
        }

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data) as StreamChunk;
        } catch {
          continue;
        }

        if (chunk.error) {
          throw new LlmError(errorMessage(chunk.error, "LLM 스트림 오류"));
        }
        if (chunk.model) resolvedModel = chunk.model;

        const delta = chunk.choices?.[0]?.delta;
        const reasoning = delta?.reasoning_content;
        if (typeof reasoning === "string" && reasoning) {
          options.onReasoning?.(reasoning);
        }
        const piece = delta?.content;
        if (typeof piece === "string" && piece) {
          content += piece;
          options.onDelta?.(piece);
        }
      }
    }

    const trimmed = content.trim();
    if (!trimmed) {
      throw new LlmError("LLM 응답 content가 비어 있음");
    }
    return { content: trimmed, model: resolvedModel };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (isAbortError(err)) {
      if (options.signal?.aborted) {
        throw new LlmError("요청이 취소됐어요", 499);
      }
      throw new LlmError(
        `LLM 요청 시간 초과 (${Math.round(timeoutMs / 1000)}초)`,
        504,
      );
    }
    throw new LlmError(
      err instanceof Error ? err.message : "LLM 요청 실패",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
