import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { StorageEngine } from "multer";
import { LoggerService } from "@/handlers/logger";

type UploadStage =
  | "reading-multipart"
  | "validating-upload"
  | "validating-assignment"
  | "transferring-to-printer"
  | "starting-print"
  | "processing-file"
  | "file-processing-failed"
  | "sending-response";

type UploadObservation =
  | "request-body-ended"
  | "temporary-file-write-started"
  | "temporary-file-write-finished"
  | "temporary-file-write-failed";
const trackers = new WeakMap<
  Response,
  {
    stage: (stage: UploadStage) => void;
    observe: (event: UploadObservation, fileBytes?: number) => void;
  }
>();

export const printerUploadDiagnostics: RequestHandler = (req, res, next) => {
  const match = req.method === "POST" && /^\/api\/v2\/printer-files\/(\d+)\/upload\/?$/i.exec(req.path);
  if (!match) return next();

  const logger = new LoggerService("PrinterUploadDiagnostics");
  const requestId = randomUUID();
  const printerId = Number(match[1]);
  const startedAt = performance.now();
  let lastStage = "received";
  let stageStartedAt = startedAt;
  const record = (stage: string, details?: { statusCode?: number; fileBytes?: number }, advanceStage = true) => {
    const now = performance.now();
    logger.warn("Printer upload diagnostics", {
      meta: {
        requestId,
        printerId,
        stage,
        previousStage: stage === "received" ? undefined : lastStage,
        elapsedMs: Math.round(now - startedAt),
        previousStageMs: stage === "received" ? undefined : Math.round(now - stageStartedAt),
        requestComplete: req.complete,
        ...details,
      },
    });
    if (advanceStage) {
      lastStage = stage;
      stageStartedAt = now;
    }
  };
  record("received");
  trackers.set(res, {
    stage: record,
    observe: (event, fileBytes) => record(event, { fileBytes }, false),
  });
  const onBodyEnd = () => trackers.get(res)?.observe("request-body-ended");
  req.once("end", onBodyEnd);
  const stopTracking = () => {
    req.off("end", onBodyEnd);
    trackers.delete(res);
  };
  res.once("finish", () => {
    stopTracking();
    record("response-finished", { statusCode: res.statusCode });
  });
  res.once("close", () => {
    if (res.writableFinished) return;
    stopTracking();
    record("client-disconnected");
  });
  next();
};

export function recordPrinterUploadStage(res: Response, stage: UploadStage) {
  trackers.get(res)?.stage(stage);
}

export function observePrinterUploadStorage(storage: StorageEngine, res?: Response): StorageEngine {
  if (!res || !trackers.has(res)) return storage;

  return {
    _handleFile(req, file, callback) {
      trackers.get(res)?.observe("temporary-file-write-started");
      storage._handleFile(req, file, (error, info) => {
        if (error) trackers.get(res)?.observe("temporary-file-write-failed");
        else trackers.get(res)?.observe("temporary-file-write-finished", info?.size);
        callback(error, info);
      });
    },
    _removeFile: storage._removeFile.bind(storage),
  };
}
