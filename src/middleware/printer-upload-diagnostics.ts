import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
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

const trackers = new WeakMap<Response, (stage: UploadStage) => void>();
export const printerUploadDiagnostics: RequestHandler = (req, res, next) => {
  const match = req.method === "POST" && /^\/api\/v2\/printer-files\/(\d+)\/upload\/?$/i.exec(req.path);
  if (!match) return next();

  const logger = new LoggerService("PrinterUploadDiagnostics");
  const requestId = randomUUID();
  const printerId = Number(match[1]);
  const startedAt = performance.now();
  let lastStage = "received";
  let stageStartedAt = startedAt;
  const record = (stage: string, statusCode?: number) => {
    const now = performance.now();
    logger.warn("Printer upload diagnostics", {
      meta: {
        requestId,
        printerId,
        stage,
        previousStage: stage === "received" ? undefined : lastStage,
        elapsedMs: Math.round(now - startedAt),
        previousStageMs: stage === "received" ? undefined : Math.round(now - stageStartedAt),
        statusCode,
      },
    });
    lastStage = stage;
    stageStartedAt = now;
  };
  record("received");
  trackers.set(res, record);
  res.once("finish", () => {
    trackers.delete(res);
    record("response-finished", res.statusCode);
  });
  res.once("close", () => {
    if (res.writableFinished) return;
    trackers.delete(res);
    record("client-disconnected");
  });
  next();
};

export function recordPrinterUploadStage(res: Response, stage: UploadStage) {
  trackers.get(res)?.(stage);
}
