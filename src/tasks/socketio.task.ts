import { SocketIoGateway, IO_MESSAGES } from "@/state/socket-io.gateway";
import { socketIoConnectedEvent } from "@/constants/event.constants";
import { PrinterSocketStore } from "@/state/printer-socket.store";
import { PrinterEventsCache } from "@/state/printer-events.cache";
import { FloorStore } from "@/state/floor.store";
import { FileUploadTrackerCache } from "@/state/file-upload-tracker.cache";
import EventEmitter2 from "eventemitter2";
import { PrinterCache } from "@/state/printer.cache";
import { LoggerService } from "@/handlers/logger";
import type { ILoggerFactory } from "@/handlers/logger-factory";
import { SettingsStore } from "@/state/settings.store";
import { PrintJobService } from "@/services/orm/print-job.service";

export class SocketIoTask {
  logger: LoggerService;

  constructor(
    loggerFactory: ILoggerFactory,
    private readonly socketIoGateway: SocketIoGateway,
    private readonly floorStore: FloorStore,
    private readonly printerSocketStore: PrinterSocketStore,
    private readonly printerEventsCache: PrinterEventsCache,
    private readonly printerCache: PrinterCache,
    private readonly fileUploadTrackerCache: FileUploadTrackerCache,
    private readonly eventEmitter2: EventEmitter2,
    private readonly settingsStore: SettingsStore,
    private readonly printJobService: PrintJobService,
  ) {
    this.logger = loggerFactory(SocketIoTask.name);

    this.eventEmitter2.on(socketIoConnectedEvent, async () => {
      await this.sendUpdate();
    });
  }

  async run() {
    await this.sendUpdate();
  }

  async sendUpdate() {
    const floors = await this.floorStore.listCache();
    const printers = await this.printerCache.listCachedPrinters(true);
    const socketStates = this.printerSocketStore.getSocketStatesById();
    const printerEvents = await this.printerEventsCache.getAllKeyValues();
    const trackedUploads = this.fileUploadTrackerCache.getUploads();
    const assignments = this.settingsStore.getServerSettings().showPrintAssigneeOnGrid
      ? await this.printJobService.getActivePrintAssignments()
      : undefined;
    const eventsWithAssignments = assignments
      ? Object.fromEntries(
          Object.entries(printerEvents).map(([id, events]) => [
            id,
            { ...events, currentPrintAssignment: assignments[Number(id)] ?? null },
          ]),
        )
      : printerEvents;

    const socketIoData = {
      printers,
      floors,
      socketStates,
      printerEvents: eventsWithAssignments,
      trackedUploads,
    };

    this.socketIoGateway.send(IO_MESSAGES.Update, socketIoData);
  }
}
