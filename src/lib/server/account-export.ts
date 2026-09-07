export const MAX_ACCOUNT_EXPORT_ROWS = 20_000;
export const MAX_ACCOUNT_EXPORT_BYTES = 16 * 1024 * 1024;

export class AccountExportLimitError extends Error {
  constructor() {
    super("account_export_limit_exceeded");
    this.name = "AccountExportLimitError";
  }
}

const encoder = new TextEncoder();

export class AccountExportBudget {
  private rows = 0;
  private bytes = 0;

  add(values: unknown[]): void {
    this.rows += values.length;
    this.bytes += encoder.encode(JSON.stringify(values)).byteLength;
    if (
      this.rows > MAX_ACCOUNT_EXPORT_ROWS ||
      this.bytes > MAX_ACCOUNT_EXPORT_BYTES
    )
      throw new AccountExportLimitError();
  }
}

export function serializeBoundedAccountExport(value: unknown): {
  body: string;
  byteLength: number;
} {
  const body = JSON.stringify(value);
  const encoded = encoder.encode(body);
  if (encoded.byteLength > MAX_ACCOUNT_EXPORT_BYTES)
    throw new AccountExportLimitError();
  return { body, byteLength: encoded.byteLength };
}
