import test from "node:test";
import assert from "node:assert/strict";

const { openaiToCloudCodeGeminiRequest } =
  await import("../../open-sse/translator/request/openai-to-gemini.ts");

function getFunctionResponse(part: unknown): { id?: string; name?: string; response?: Record<string, unknown> } | null {
  if (!part || typeof part !== "object") return null;
  const p = part as { functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> } };
  return p.functionResponse ?? null;
}

test("OpenAI -> Cloud Code Gemini preserves empty tool response (content: '') as native functionResponse", () => {
  const request = openaiToCloudCodeGeminiRequest(
    "gemini-3-flash-preview",
    {
      messages: [
        { role: "user", content: "Run command" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_empty_1",
              type: "function",
              function: { name: "terminal", arguments: '{"command":"true"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_empty_1",
          content: "",
        },
      ],
    },
    true
  ) as {
    contents: Array<{
      role: string;
      parts: Array<{
        functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
      }>;
    }>;
  };

  const toolTurn = request.contents.find(
    (content) =>
      content.role === "user" &&
      content.parts.some((part) => part.functionResponse !== undefined)
  );
  assert.ok(
    toolTurn,
    "expected Cloud Code Gemini tool response turn even when content is empty string"
  );
  assert.deepEqual(getFunctionResponse(toolTurn.parts[0]), {
    id: "call_empty_1",
    name: "terminal",
    response: { result: "" },
  });
});
