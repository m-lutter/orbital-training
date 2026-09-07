export class UnsupportedJsonMediaTypeError extends Error {}
export class JsonBodyTooLargeError extends Error {}
export class InvalidJsonBodyError extends Error {}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json"))
    throw new UnsupportedJsonMediaTypeError(
      "Expected an application/json body.",
    );

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new JsonBodyTooLargeError("The JSON body is too large.");

  const reader = request.body?.getReader();
  if (reader === undefined)
    throw new InvalidJsonBodyError("The JSON body is empty.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new JsonBodyTooLargeError("The JSON body is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidJsonBodyError("The JSON body is invalid.");
  }
}
