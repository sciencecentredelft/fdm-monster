import { DataSource } from "typeorm";
import { expect, it, vi } from "vitest";
import { LoggerService } from "@/handlers/logger";
import {
  countOctoPrintCurrent,
  SqliteQueryDiagnostics,
  startSqliteQueryCapture,
  withOctoPrintQueryContext,
} from "@/handlers/sqlite-query-diagnostics";

it("groups real SQLite queries by shape and OctoPrint operation without logging query data", async () => {
  const db = await new DataSource({ type: "better-sqlite3", database: ":memory:" }).initialize();
  db.subscribers.push(new SqliteQueryDiagnostics());
  const logger = new LoggerService("SQLiteDiagnosticsTest");
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    await db.query("SELECT 'before-capture'");
    startSqliteQueryCapture(logger);
    countOctoPrintCurrent();
    await withOctoPrintQueryContext("start", async () => {
      await db.query("SELECT 'private-inline-one', ?", ["private-first-bound"]);
      await db.query("SELECT 'private-inline-two', ?", ["private-bound"]);
    });
    await db.query("SELECT 'private-other', ?", ["private-other-bound"]);
    await vi.advanceTimersByTimeAsync(20_000);
    await db.query("SELECT 'after-capture'");

    expect(warn).toHaveBeenCalledWith("SQLite query diagnostics summary", {
      meta: expect.objectContaining({ queries: 3, queryGroups: 2, octoPrintCurrentEvents: 1 }),
    });
    const groups = warn.mock.calls.filter(([message]) => message === "SQLite query diagnostics group");
    expect(groups.map(([, options]) => options?.meta)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "octoprint.start",
          operation: "SELECT",
          calls: 2,
          totalMs: expect.any(Number),
          maxMs: expect.any(Number),
        }),
        expect.objectContaining({ source: "unattributed", calls: 1 }),
      ]),
    );
    expect(groups[0][1].meta.fingerprint).toBe(groups[1][1].meta.fingerprint);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-");
  } finally {
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    await db.destroy();
  }
});
