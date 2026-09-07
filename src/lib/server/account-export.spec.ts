import { describe, expect, it } from "vitest";
import {
  AccountExportBudget,
  AccountExportLimitError,
  MAX_ACCOUNT_EXPORT_BYTES,
  MAX_ACCOUNT_EXPORT_ROWS,
  serializeBoundedAccountExport,
} from "./account-export";

describe("account export bounds", () => {
  it("accepts an ordinary compact export", () => {
    const budget = new AccountExportBudget();
    budget.add([{ id: "one" }, { id: "two" }]);
    const encoded = serializeBoundedAccountExport({ rows: [{ id: "one" }] });
    expect(encoded.body).toBe(JSON.stringify({ rows: [{ id: "one" }] }));
  });

  it("stops exports with too many records or bytes", () => {
    const budget = new AccountExportBudget();
    expect(() =>
      budget.add(Array(MAX_ACCOUNT_EXPORT_ROWS + 1).fill(null)),
    ).toThrow(AccountExportLimitError);
    expect(() =>
      serializeBoundedAccountExport({
        value: "x".repeat(MAX_ACCOUNT_EXPORT_BYTES),
      }),
    ).toThrow(AccountExportLimitError);
  });
});
