import { describe, expect, it } from "vitest";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  readBoundedJson,
  UnsupportedJsonMediaTypeError,
} from "./bounded-json";

function jsonRequest(body: string, headers: HeadersInit = {}): Request {
  return new Request("https://training.example/api", {
    method: "POST",
    body,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

describe("readBoundedJson", () => {
  it("parses a JSON object within the byte limit", async () => {
    await expect(
      readBoundedJson(jsonRequest('{"message":"ok"}'), 64),
    ).resolves.toEqual({
      message: "ok",
    });
  });

  it("rejects unsupported and malformed request bodies", async () => {
    const textRequest = new Request("https://training.example/api", {
      method: "POST",
      body: "hello",
      headers: { "content-type": "text/plain" },
    });
    await expect(readBoundedJson(textRequest, 64)).rejects.toBeInstanceOf(
      UnsupportedJsonMediaTypeError,
    );
    await expect(readBoundedJson(jsonRequest("{"), 64)).rejects.toBeInstanceOf(
      InvalidJsonBodyError,
    );
  });

  it("rejects declared and streamed bodies above the byte limit", async () => {
    await expect(
      readBoundedJson(jsonRequest("{}", { "content-length": "1000" }), 64),
    ).rejects.toBeInstanceOf(JsonBodyTooLargeError);
    await expect(
      readBoundedJson(
        jsonRequest(JSON.stringify({ value: "x".repeat(100) })),
        32,
      ),
    ).rejects.toBeInstanceOf(JsonBodyTooLargeError);
  });
});
