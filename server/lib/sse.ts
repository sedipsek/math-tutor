import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { GenerateProgressEvent } from "./generate.ts";

export async function writeProgress(
  stream: SSEStreamingApi,
  event: GenerateProgressEvent,
): Promise<void> {
  if (event.type === "stage") {
    await stream.writeSSE({
      event: "stage",
      data: JSON.stringify({
        stage: event.stage,
        index: event.index,
        total: event.total,
        attempt: event.attempt,
      }),
    });
    return;
  }
  await stream.writeSSE({
    event: event.type,
    data: JSON.stringify({ text: event.text }),
  });
}

export function sseResponse(
  c: Context,
  run: (stream: SSEStreamingApi) => Promise<void>,
) {
  return streamSSE(c, async (stream) => {
    try {
      await run(stream);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "스트림 처리 중 오류";
      try {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message }),
        });
      } catch {
        /* client gone */
      }
    }
  });
}
