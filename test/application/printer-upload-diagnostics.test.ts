import express from "express";
import multer from "multer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { LoggerService } from "@/handlers/logger";
import {
  observePrinterUploadStorage,
  printerUploadDiagnostics,
  recordPrinterUploadStage,
} from "@/middleware/printer-upload-diagnostics";

afterEach(() => vi.restoreAllMocks());

it("correlates upload stages and the response without logging request data", async () => {
  const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
  const app = express().use(printerUploadDiagnostics);
  app.post("/api/v2/printer-files/:id/upload", (_req, res) => {
    recordPrinterUploadStage(res, "processing-file");
    res.sendStatus(200);
  });

  await request(app)
    .post("/api/v2/printer-files/2/upload?token=private-query")
    .set("Authorization", "Bearer private-credential")
    .expect(200);

  const metadata = warn.mock.calls.map(([, options]) => options?.meta);
  expect(metadata).toEqual([
    expect.objectContaining({ requestId: expect.any(String), printerId: 2, stage: "received" }),
    expect.objectContaining({ printerId: 2, stage: "processing-file", previousStage: "received" }),
    expect.objectContaining({
      printerId: 2,
      stage: "response-finished",
      previousStage: "processing-file",
      statusCode: 200,
    }),
  ]);
  expect(new Set(metadata.map((entry) => entry?.requestId)).size).toBe(1);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private-");
});

it("reports body completion and the disk write separately before the response", async () => {
  const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
  const destination = await mkdtemp(join(tmpdir(), "printer-upload-diagnostics-"));
  const app = express().use(printerUploadDiagnostics);
  app.post("/api/v2/printer-files/:id/upload", (req, res, next) => {
    recordPrinterUploadStage(res, "reading-multipart");
    const storage = observePrinterUploadStorage(multer.diskStorage({ destination }), res);
    multer({ storage }).any()(req, res, (error) => {
      if (error) return next(error);
      res.sendStatus(200);
    });
  });

  try {
    const data = Buffer.from("private-file-data");
    await request(app)
      .post("/api/v2/printer-files/2/upload")
      .attach("files[0]", data, "private-filename.gcode")
      .expect(200);

    const metadata = warn.mock.calls.map(([, options]) => options?.meta);
    expect(metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "temporary-file-write-started" }),
        expect.objectContaining({
          stage: "request-body-ended",
          requestComplete: true,
          previousStage: "reading-multipart",
        }),
        expect.objectContaining({ stage: "temporary-file-write-finished", fileBytes: data.length }),
      ]),
    );
    expect(metadata.at(-1)).toMatchObject({ stage: "response-finished", requestComplete: true, statusCode: 200 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-");
  } finally {
    await rm(destination, { recursive: true });
  }
});
