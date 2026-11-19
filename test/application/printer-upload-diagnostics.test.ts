import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { LoggerService } from "@/handlers/logger";
import { printerUploadDiagnostics, recordPrinterUploadStage } from "@/middleware/printer-upload-diagnostics";

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
