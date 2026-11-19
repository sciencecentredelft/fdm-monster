import { DataSource } from "typeorm";
import { expect, it } from "vitest";
import { AppDataSource } from "@/data-source";
import { PrintJob } from "@/entities/print-job.entity";
import { Printer } from "@/entities/printer.entity";
import { IndexPrintJobActiveLookup1778446203019 } from "@/migrations/1778446203019-IndexPrintJobActiveLookup";

it("indexes the latest active job lookup on upgrade and preserves jobs on rollback", async () => {
  const db = await new DataSource({ ...AppDataSource.options, database: ":memory:" }).initialize();
  try {
    await db.runMigrations();
    await db.undoLastMigration();

    const printers = db.getRepository(Printer);
    const printer = await printers.save({ name: "Test", printerURL: "http://printer.example" });
    const otherPrinter = await printers.save({ name: "Other", printerURL: "http://other.example" });
    const jobs = db.getRepository(PrintJob);
    await jobs.insert([
      { printerId: printer.id, status: "PRINTING", startedAt: new Date("2026-01-01"), fileName: "older.gcode" },
      { printerId: printer.id, status: "PRINTING", startedAt: new Date("2026-01-02"), fileName: "active.gcode" },
      { printerId: printer.id, status: "COMPLETED", startedAt: new Date("2026-01-03"), fileName: "done.gcode" },
      { printerId: otherPrinter.id, status: "PRINTING", startedAt: new Date("2026-01-04"), fileName: "other.gcode" },
    ]);

    const options = {
      where: { printerId: printer.id, status: "PRINTING" },
      order: { startedAt: "DESC" },
      take: 1,
    } as const;
    const [sql, parameters] = jobs.createQueryBuilder("PrintJob").setFindOptions(options).getQueryAndParameters();
    const explain = async () =>
      (await db.query<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${sql}`, parameters)).map(({ detail }) => detail);

    const before = await explain();
    expect(before).toContainEqual(expect.stringMatching(/SCAN PrintJob/i));
    expect(before).toContainEqual(expect.stringContaining("TEMP B-TREE"));
    expect((await jobs.findOne(options))?.fileName).toBe("active.gcode");

    const applied = await db.runMigrations();
    expect(applied.map(({ name }) => name)).toEqual([IndexPrintJobActiveLookup1778446203019.name]);
    const after = await explain();
    expect(after).toContainEqual(expect.stringContaining("USING INDEX IDX_print_job_printer_status_started_at"));
    expect(after).not.toContainEqual(expect.stringContaining("TEMP B-TREE"));
    expect((await jobs.findOne(options))?.fileName).toBe("active.gcode");

    await db.undoLastMigration();
    expect(await explain()).toEqual(before);
    expect((await jobs.findOne(options))?.fileName).toBe("active.gcode");
    expect(await jobs.count()).toBe(4);
  } finally {
    await db.destroy();
  }
});
