import { setupTestApp } from "../test-server";
import { createTestPrinter } from "../api/test-data/create-printer";
import { DITokens } from "@/container.tokens";
import { PrintJobService } from "@/services/orm/print-job.service";

describe("per-print assignment", () => {
  let service: PrintJobService;
  let createPrinter: () => Promise<{ id: number }>;

  beforeAll(async () => {
    const { container, request } = await setupTestApp(true);
    service = container.resolve<PrintJobService>(DITokens.printJobService);
    createPrinter = () => createTestPrinter(request);
  });

  it("persists the name before an early printer event and creates only one run", async () => {
    const printer = await createPrinter();
    await service.printJobRepository.save({ printerId: printer.id, fileName: "folder/test.gcode", status: "PENDING" });
    const job = await service.startAssignedPrint(printer.id, "folder/test.gcode", "Alice", async () => {
      const observed = await service.markStarted(printer.id, "folder/test.gcode");
      expect(observed.assignedTo).toBe("Alice");
    });
    expect(job.status).toBe("PRINTING");
    expect((await service.getJobByIdOrFail(job.id)).assignedTo).toBe("Alice");
    expect(await service.printJobRepository.countBy({ printerId: printer.id, status: "PRINTING" })).toBe(1);
    expect((await service.markStarted(printer.id, "folder/test.gcode")).id).toBe(job.id);
  });

  it("serializes concurrent start observations against the same assigned run", async () => {
    const printer = await createPrinter();
    const job = await service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {
      await Promise.all([service.markStarted(printer.id, "test.gcode"), service.markStarted(printer.id, "test.gcode")]);
    });
    expect(await service.printJobRepository.countBy({ printerId: printer.id })).toBe(1);
    expect(job.assignedTo).toBe("Alice");
  });

  it("does not leave an assignment for a later print when the command fails", async () => {
    const printer = await createPrinter();
    await expect(
      service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {
        throw new Error("Printer rejected the command");
      }),
    ).rejects.toThrow("Printer rejected");
    const [failed] = await service.getPrintJobHistory(printer.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.startedAt).toBeNull();
    expect(await service.getLastPrintStarts(printer.id)).toEqual([]);
    const external = await service.markStarted(printer.id, "test.gcode");
    expect(external.id).not.toBe(failed.id);
    expect(external.assignedTo).toBeNull();
  });

  it("does not mark an observed print as failed if the response subsequently fails", async () => {
    const printer = await createPrinter();
    await expect(
      service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {
        await service.markStarted(printer.id, "test.gcode");
        throw new Error("Response timed out");
      }),
    ).rejects.toThrow("Response timed out");
    const job = await service.getActivePrintJob(printer.id);
    expect(job?.assignedTo).toBe("Alice");
    expect(job?.status).toBe("PRINTING");
  });

  it("uses a fresh assignment for a reprint and does not copy it into external reprints", async () => {
    const printer = await createPrinter();
    const first = await service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {});
    await service.markFinished(printer.id, "test.gcode");
    const second = await service.startAssignedPrint(printer.id, "test.gcode", "Bob", async () => {});
    expect(second.id).not.toBe(first.id);
    expect(second.assignedTo).toBe("Bob");
    expect((await service.getJobByIdOrFail(first.id)).assignedTo).toBe("Alice");
    await service.markFinished(printer.id, "test.gcode");
    expect((await service.markStarted(printer.id, "test.gcode")).assignedTo).toBeNull();
  });

  it("rejects a second request while a start command is in progress", async () => {
    const printer = await createPrinter();
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = service.startAssignedPrint(printer.id, "a.gcode", "Alice", async () => {
      entered();
      await gate;
    });
    await ready;
    try {
      await expect(
        service.startAssignedPrint(printer.id, "b.gcode", "Bob", async () => {
          throw new Error("Must not send a second command");
        }),
      ).rejects.toThrow("already being started");
    } finally {
      release();
      await first;
    }
  });

  it("does not reuse a start interrupted by a server restart", async () => {
    const printer = await createPrinter();
    const interrupted = await service.printJobRepository.save({
      printerId: printer.id,
      fileName: "test.gcode",
      assignedTo: "Alice",
      status: "STARTING",
    });
    const queuedStart = await service.printJobRepository.save({
      printerId: printer.id,
      fileName: "queued.gcode",
      status: "STARTING",
    });
    await service.failInterruptedAssignedStarts();
    expect((await service.getJobByIdOrFail(interrupted.id)).status).toBe("FAILED");
    expect((await service.getJobByIdOrFail(queuedStart.id)).status).toBe("STARTING");
    expect((await service.markStarted(printer.id, "test.gcode")).assignedTo).toBeNull();
  });

  it("returns the latest run's name (including null), with deterministic ties and exact path isolation", async () => {
    const printer = await createPrinter();
    const other = await createPrinter();
    const date = new Date("2026-01-01T10:00:00Z");
    await service.printJobRepository.save([
      { printerId: printer.id, fileName: "a/test.gcode", assignedTo: "Old", startedAt: date },
      { printerId: printer.id, fileName: "a/test.gcode", assignedTo: null, startedAt: date },
      { printerId: printer.id, fileName: "b/test.gcode", assignedTo: "Bob", startedAt: date },
      { printerId: other.id, fileName: "b/test.gcode", assignedTo: "Other printer", startedAt: date },
      { printerId: printer.id, fileName: "a/test.gcode", assignedTo: "Never started", startedAt: null },
    ]);
    expect(await service.getLastPrintStarts(printer.id)).toEqual(
      expect.arrayContaining([
        { fileName: "a/test.gcode", assignedTo: null, startedAt: date.toISOString() },
        { fileName: "b/test.gcode", assignedTo: "Bob", startedAt: date.toISOString() },
      ]),
    );
  });

  it("allows a printer-accepted reprint even if history still says the previous run is printing", async () => {
    const printer = await createPrinter();
    const old = await service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {});
    const next = await service.startAssignedPrint(printer.id, "test.gcode", "Bob", async () => {
      // A delayed status message may still describe the previous run before the command returns.
      await service.markStarted(printer.id, "test.gcode");
    });

    expect(next.id).not.toBe(old.id);
    expect(next.assignedTo).toBe("Bob");
    expect((await service.getJobByIdOrFail(old.id)).status).toBe("UNKNOWN");
    expect((await service.getActivePrintJob(printer.id))?.id).toBe(next.id);
  });

  it("does not copy stored file data when uploading new contents with the same filename", async () => {
    const printer = await createPrinter();
    await service.printJobRepository.save({
      printerId: printer.id,
      fileName: "test.gcode",
      status: "COMPLETED",
      analysisState: "ANALYZED",
      fileHash: "old-file-hash",
      fileStorageId: "old-file",
    });
    const job = await service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {}, {
      uploading: true,
    });
    expect(job.fileHash).toBeNull();
    expect(job.fileStorageId).toBeNull();
    expect(job.analysisState).toBe("ANALYZING");
  });
});
