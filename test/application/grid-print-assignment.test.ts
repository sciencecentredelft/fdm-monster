import { setupTestApp } from "../test-server";
import { createTestPrinter } from "../api/test-data/create-printer";
import { DITokens } from "@/container.tokens";
import { PrintJobService } from "@/services/orm/print-job.service";
import { SettingsStore } from "@/state/settings.store";
import { SocketIoTask } from "@/tasks/socketio.task";
import { SocketIoGateway, IO_MESSAGES } from "@/state/socket-io.gateway";
import { PrinterEventsCache } from "@/state/printer-events.cache";

describe("grid print assignments in live updates", () => {
  let service: PrintJobService;
  let settings: SettingsStore;
  let task: SocketIoTask;
  let gateway: SocketIoGateway;
  let events: PrinterEventsCache;
  let createPrinter: () => Promise<{ id: number }>;

  beforeAll(async () => {
    const { container, request } = await setupTestApp(true);
    service = container.resolve<PrintJobService>(DITokens.printJobService);
    settings = container.resolve<SettingsStore>(DITokens.settingsStore);
    task = container.resolve<SocketIoTask>(DITokens.socketIoTask);
    gateway = container.resolve<SocketIoGateway>(DITokens.socketIoGateway);
    events = container.resolve<PrinterEventsCache>(DITokens.printerEventsCache);
    createPrinter = () => createTestPrinter(request);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await settings.setShowPrintAssigneeOnGrid(false);
  });

  it("does not query assignments or change the socket payload when disabled", async () => {
    const lookup = vi.spyOn(service, "getActivePrintAssignments");
    const send = vi.spyOn(gateway, "send").mockImplementation(() => {});
    const original = await events.getAllKeyValues();
    await task.sendUpdate();
    expect(lookup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(IO_MESSAGES.Update, expect.objectContaining({ printerEvents: original }));
  });

  it("returns only the latest active run per printer, including paused and unassigned runs", async () => {
    const printer = await createPrinter();
    const other = await createPrinter();
    await service.printJobRepository.save([
      {
        printerId: printer.id,
        fileName: "old.gcode",
        assignedTo: "Old person",
        status: "PRINTING",
        startedAt: new Date("2026-01-01"),
      },
      {
        printerId: printer.id,
        fileName: "current.gcode",
        assignedTo: null,
        status: "PRINTING",
        startedAt: new Date("2026-02-01"),
      },
      { printerId: other.id, fileName: "paused.gcode", assignedTo: "Paused person", status: "PAUSED" },
      { printerId: other.id, fileName: "done.gcode", assignedTo: "Finished person", status: "COMPLETED" },
    ]);
    const assignments = await service.getActivePrintAssignments();
    expect(assignments[printer.id]).toEqual({ fileName: "current.gcode", assignedTo: null });
    expect(assignments[other.id]).toEqual({ fileName: "paused.gcode", assignedTo: "Paused person" });
  });

  it("adds assignments through one live-update query without mutating the printer cache", async () => {
    const printer = await createPrinter();
    await events.getOrCreateEvents(printer.id);
    const job = await service.startAssignedPrint(printer.id, "test.gcode", "Alice", async () => {});
    await settings.setShowPrintAssigneeOnGrid(true);
    const lookup = vi.spyOn(service, "getActivePrintAssignments");
    const send = vi.spyOn(gateway, "send").mockImplementation(() => {});
    await task.sendUpdate();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(
      IO_MESSAGES.Update,
      expect.objectContaining({
        printerEvents: expect.objectContaining({
          [printer.id]: expect.objectContaining({
            currentPrintAssignment: { fileName: "test.gcode", assignedTo: "Alice" },
          }),
        }),
      }),
    );
    expect(await events.getPrinterSocketEvents(printer.id)).not.toHaveProperty("currentPrintAssignment");
    await settings.setShowPrintAssigneeOnGrid(false);
    await task.sendUpdate();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(
      IO_MESSAGES.Update,
      expect.objectContaining({ printerEvents: await events.getAllKeyValues() }),
    );
    await settings.setShowPrintAssigneeOnGrid(true);
    await service.markAsCompleted(job.id);
    await task.sendUpdate();
    expect(send).toHaveBeenLastCalledWith(
      IO_MESSAGES.Update,
      expect.objectContaining({
        printerEvents: expect.objectContaining({
          [printer.id]: expect.objectContaining({ currentPrintAssignment: null }),
        }),
      }),
    );
  });
});
