import { setupTestApp } from "../test-server";
import { createTestPrinter, createTestBambuPrinter } from "./test-data/create-printer";
import { expectInvalidResponse, expectNotFoundResponse, expectOkResponse } from "../extensions";
import { AppConstants } from "@/server.constants";
import nock, { Body, ReplyHeaders } from "nock";
import { Test } from "supertest";
import { PrinterFilesController } from "@/controllers/printer-files.controller";
import { AwilixContainer, asClass } from "awilix";
import { DITokens } from "@/container.tokens";
import { IPrinterService } from "@/services/interfaces/printer.service.interface";
import TestAgent from "supertest/lib/agent";
import { BambuApiStub } from "./stubs/bambu.api.stub";
import { BambuClientStub } from "./stubs/bambu.client.stub";
import { BambuFtpAdapterStub } from "./stubs/bambu-ftp.adapter.stub";
import { BambuMqttAdapterStub } from "./stubs/bambu-mqtt.adapter.stub";
import { SettingsStore } from "@/state/settings.store";
import { PrintJobService } from "@/services/orm/print-job.service";

const defaultRoute = AppConstants.apiRoute + "/printer-files";
const thumbnailsRoute = `${defaultRoute}/thumbnails`;
const getRoute = (id: number) => `${defaultRoute}/${id}`;
const clearFilesRoute = (id: number) => `${getRoute(id)}/clear`;
const deleteFileRoute = (id: number, path: string) => `${getRoute(id)}?path=${path}`;
const printFileRoute = (id: number) => `${getRoute(id)}/print`;
const uploadFileRoute = (id: number) => `${getRoute(id)}/upload`;
const getFilesRoute = (id: number) => `${getRoute(id)}`;
const downloadFileRoute = (id: number, path: string) => `${getRoute(id)}/download/${path}`;
const getPrintThumbnailRoute = (id: number) => `${getRoute(id)}/thumbnail`;

let request: TestAgent<Test>;
let container: AwilixContainer;
let printerService: IPrinterService;

beforeAll(async () => {
  // Set up test app with stub implementations for Bambu services
  const stubMocks = {
    [DITokens.bambuApi]: asClass(BambuApiStub).transient(),
    [DITokens.bambuClient]: asClass(BambuClientStub).transient(),
    [DITokens.bambuFtpAdapter]: asClass(BambuFtpAdapterStub).transient(),
    [DITokens.bambuMqttAdapter]: asClass(BambuMqttAdapterStub).transient(),
  };

  ({ request, container } = await setupTestApp(true, stubMocks));
  const settingsStore = container.resolve<SettingsStore>(DITokens.settingsStore);
  await settingsStore.setExperimentalBambuSupport(true);

  printerService = container.resolve<IPrinterService>(DITokens.printerService);
});

beforeEach(async () => {
  const printers = await printerService.list();
  for (let printer of printers) {
    await printerService.delete(printer.id);
  }
});

describe(PrinterFilesController.name, () => {
  const gcodePath = "test/api/test-data/sample.gcode";
  const examplBambuFilePath = "test/api/test-data/sample.3mf";

  describe("last print starts", () => {
    afterEach(async () => {
      await container.resolve<SettingsStore>(DITokens.settingsStore).setAdvancedFileListEnabled(false);
    });

    it("should not expose print starts when the advanced file list is disabled", async () => {
      const printer = await createTestPrinter(request);
      const response = await request.get(`${getRoute(printer.id)}/last-print-starts`);
      expectNotFoundResponse(response);
    });

    it("should return the latest start per exact file path for only the requested printer", async () => {
      const printer = await createTestPrinter(request);
      const otherPrinter = await createTestPrinter(request);
      const settings = container.resolve<SettingsStore>(DITokens.settingsStore);
      await settings.setAdvancedFileListEnabled(true);
      const service = container.resolve<PrintJobService>(DITokens.printJobService);
      await service.printJobRepository.save([
        { printerId: printer.id, fileName: "folder/test.gcode", startedAt: new Date("2026-10-01T10:30:00Z") },
        { printerId: printer.id, fileName: "folder/test.gcode", startedAt: new Date("2026-10-02T12:45:00Z") },
        { printerId: printer.id, fileName: "other/test.gcode", startedAt: new Date("2026-10-03T14:00:00Z") },
        { printerId: printer.id, fileName: "never.gcode", startedAt: null },
        { printerId: otherPrinter.id, fileName: "folder/test.gcode", startedAt: new Date("2026-10-04T12:00:00Z") },
      ]);

      const response = await request.get(`${getRoute(printer.id)}/last-print-starts`);
      expectOkResponse(response);
      expect(response.body).toHaveLength(2);
      expect(response.body).toEqual(
        expect.arrayContaining([
          { fileName: "folder/test.gcode", startedAt: "2026-10-02T12:45:00.000Z", assignedTo: null },
          { fileName: "other/test.gcode", startedAt: "2026-10-03T14:00:00.000Z", assignedTo: null },
        ]),
      );
    });

    it("should return an empty list for a printer without recorded starts", async () => {
      const printer = await createTestPrinter(request);
      await container.resolve<SettingsStore>(DITokens.settingsStore).setAdvancedFileListEnabled(true);
      expectOkResponse(await request.get(`${getRoute(printer.id)}/last-print-starts`), []);
    });

    it("should resolve and reject a missing printer", async () => {
      await container.resolve<SettingsStore>(DITokens.settingsStore).setAdvancedFileListEnabled(true);
      expectNotFoundResponse(await request.get(`${getRoute(999999)}/last-print-starts`));
    });
  });

  it(`should return 404 on ${defaultRoute} for nonexisting printer`, async () => {
    const res = await request.get(getRoute(101)).send();
    expectNotFoundResponse(res);
  });

  it("should retrieve files on GET for existing printer", async () => {
    const printer = await createTestPrinter(request);
    nock(printer.printerURL)
      .get("/api/files/local")
      .query("recursive=false")
      .reply(200, { files: [], free: 1, total: 1 });
    const response = await request.get(getFilesRoute(printer.id)).send();
    expectOkResponse(response, { dirs: [], files: [] });
  });

  it("should retrieve file with hash character on GET for existing printer", async () => {
    const printer = await createTestPrinter(request);
    const filename = "test#.gcode";
    const reply0 = { path: filename };
    const reply1 = JSON.stringify(reply0);
    nock(printer.printerURL)
      .get(`/downloads/files/local/${encodeURIComponent(filename)}`)
      .reply(
        200,
        reply1 as Body,
        {
          "content-type": "application/json",
          "content-length": reply1.length.toString(),
          "content-disposition": "attachment; filename=test#.gcode",
        } as ReplyHeaders,
      );
    const response = await request.get(downloadFileRoute(printer.id, encodeURIComponent(filename))).send();
    expectOkResponse(response, reply0);
  });

  it("should allow GET on printer files thumbnails cache", async () => {
    const response = await request.get(thumbnailsRoute).send();
    expectOkResponse(response);
  });

  it("should allow GET on cached printer thumbnail", async () => {
    const printer = await createTestPrinter(request);
    const response = await request.get(getPrintThumbnailRoute(printer.id)).send();
    expectOkResponse(response);
  });

  it("should allow DELETE to remove a printer file or folder", async () => {
    const printer = await createTestPrinter(request);

    const filename = "test.gcode";
    nock(printer.printerURL)
      .delete("/api/files/local/" + filename)
      .reply(200);

    const response = await request.delete(deleteFileRoute(printer.id, filename)).send();
    expectOkResponse(response);
  });

  it("should allow POST to print a printer file", async () => {
    const printer = await createTestPrinter(request);

    const filename = "test.gcode";
    nock(printer.printerURL)
      .post("/api/files/local/" + filename)
      .reply(200);

    const response = await request.post(printFileRoute(printer.id)).send({
      filePath: filename,
    });
    expectOkResponse(response);
  });

  describe("opt-in print assignment", () => {
    beforeEach(async () => {
      await container.resolve<SettingsStore>(DITokens.settingsStore).setPrintAssignmentEnabled(true);
    });
    afterEach(async () => {
      await container.resolve<SettingsStore>(DITokens.settingsStore).setPrintAssignmentEnabled(false);
    });

    it.each([undefined, "", "   ", "x".repeat(101), 42, {}])(
      "rejects an invalid name %j before printing",
      async (assignedTo) => {
        const printer = await createTestPrinter(request);
        expectInvalidResponse(
          await request.post(printFileRoute(printer.id)).send({ filePath: "test.gcode", assignedTo }),
        );
        const jobs = await container.resolve<PrintJobService>(DITokens.printJobService).getPrintJobHistory(printer.id);
        expect(jobs).toEqual([]);
      },
    );

    it("trims and persists the name for an exact path and exposes it in job details", async () => {
      const printer = await createTestPrinter(request);
      const filePath = "folder/test #.gcode";
      nock(printer.printerURL).post("/api/files/local/folder/test%20%23.gcode").reply(200);
      expectOkResponse(await request.post(printFileRoute(printer.id)).send({ filePath, assignedTo: "  Alice  " }));
      const [job] = await container.resolve<PrintJobService>(DITokens.printJobService).getPrintJobHistory(printer.id);
      expect(job).toMatchObject({ fileName: filePath, assignedTo: "Alice", status: "PRINTING" });
      const details = await request.get(`${AppConstants.apiRoute}/print-jobs/${job.id}`);
      expectOkResponse(details);
      expect(details.body.assignedTo).toBe("Alice");
      expect((await request.get(`${getRoute(printer.id)}/last-print-starts`)).body[0].assignedTo).toBe("Alice");
    });

    it("requires a name for Upload and Print but not upload-only", async () => {
      const printer = await createTestPrinter(request);
      expectInvalidResponse(
        await request.post(uploadFileRoute(printer.id)).field("startPrint", "true").attach("file", gcodePath),
      );
      nock(printer.printerURL).post("/api/files/local").reply(200);
      expectOkResponse(
        await request.post(uploadFileRoute(printer.id)).field("startPrint", "false").attach("file", gcodePath),
      );
    });

    it("attaches analyzed upload data to the assigned run without creating a second pending job", async () => {
      const printer = await createTestPrinter(request);
      nock(printer.printerURL)
        .post("/api/files/local")
        .reply(200, { files: { local: { path: "sample.gcode" } } });
      nock(printer.printerURL).post("/api/files/local/sample.gcode").reply(200);
      expectOkResponse(
        await request
          .post(uploadFileRoute(printer.id))
          .field("startPrint", "true")
          .field("assignedTo", "  Alice  ")
          .attach("file", gcodePath),
      );
      const jobs = await container.resolve<PrintJobService>(DITokens.printJobService).getPrintJobHistory(printer.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ assignedTo: "Alice", status: "PRINTING", analysisState: "ANALYZED" });
      expect(jobs[0].fileStorageId).toBeTruthy();
    });

    it("assigns the actual printer-returned upload path before starting a renamed file", async () => {
      const printer = await createTestPrinter(request);
      nock(printer.printerURL)
        .post("/api/files/local")
        .reply(201, { files: { local: { path: "renamed_file.gcode" } } });
      nock(printer.printerURL).post("/api/files/local/renamed_file.gcode").reply(200);
      expectOkResponse(
        await request
          .post(uploadFileRoute(printer.id))
          .field("startPrint", "true")
          .field("assignedTo", "Alice")
          .attach("file", gcodePath),
      );
      const jobs = await container.resolve<PrintJobService>(DITokens.printJobService).getPrintJobHistory(printer.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ fileName: "renamed_file.gcode", assignedTo: "Alice", status: "PRINTING" });
    });

    it("does not guess an uploaded path or start a print when the response is missing it", async () => {
      const printer = await createTestPrinter(request);
      nock(printer.printerURL).post("/api/files/local").reply(201, {});
      expectInvalidResponse(
        await request
          .post(uploadFileRoute(printer.id))
          .field("startPrint", "true")
          .field("assignedTo", "Alice")
          .attach("file", gcodePath),
      );
      expect(await container.resolve<PrintJobService>(DITokens.printJobService).getPrintJobHistory(printer.id)).toEqual(
        [],
      );
    });

    it("ignores assignment data when the feature is disabled", async () => {
      await container.resolve<SettingsStore>(DITokens.settingsStore).setPrintAssignmentEnabled(false);
      const printer = await createTestPrinter(request);
      nock(printer.printerURL).post("/api/files/local/test.gcode").reply(200);
      expectOkResponse(
        await request.post(printFileRoute(printer.id)).send({ filePath: "test.gcode", assignedTo: "Alice" }),
      );
      expect(await container.resolve<PrintJobService>(DITokens.printJobService).getPrintJobHistory(printer.id)).toEqual(
        [],
      );
    });
  });

  it("should allow POST upload file", async () => {
    const printer = await createTestPrinter(request);

    const apiMock = nock(printer.printerURL);
    apiMock.post("/api/files/local").reply(200, {
      files: {
        local: {
          path: "file.gcode",
          name: "file.gcode",
        },
      },
    });
    const response = await request
      .post(uploadFileRoute(printer.id))
      .field("startPrint", "true")
      .attach("file", gcodePath);
    expectOkResponse(response);
  });

  it("should deny POST to upload printer files when empty", async () => {
    const printer = await createTestPrinter(request);
    const response = await request.post(uploadFileRoute(printer.id)).send();
    expectInvalidResponse(response);
  });

  describe("Bambu printer .3mf support", () => {
    it("should accept .3mf files for Bambu printers (validation test)", async () => {
      const bambuPrinter = await createTestBambuPrinter(request);

      // Test that .3mf files are accepted and uploaded successfully for Bambu printers
      const response = await request
        .post(uploadFileRoute(bambuPrinter.id))
        .field("startPrint", "false")
        .attach("file", examplBambuFilePath);

      // With stub implementations, the upload should now succeed
      expectOkResponse(response);
    });

    it("should reject .3mf files for non-Bambu printers", async () => {
      const octoprintPrinter = await createTestPrinter(request);

      const response = await request
        .post(uploadFileRoute(octoprintPrinter.id))
        .field("startPrint", "false")
        .attach("file", examplBambuFilePath);

      expectInvalidResponse(response);
    });

    it("should not accept .gcode files for Bambu printers", async () => {
      const bambuPrinter = await createTestBambuPrinter(request);

      const response = await request
        .post(uploadFileRoute(bambuPrinter.id))
        .field("startPrint", "false")
        .attach("file", gcodePath);

      expectInvalidResponse(response);
    });

    it("should show appropriate error for empty upload on Bambu printer", async () => {
      const bambuPrinter = await createTestBambuPrinter(request);

      const response = await request.post(uploadFileRoute(bambuPrinter.id)).send();
      expectInvalidResponse(response);
    });

    it("should show appropriate error for empty upload on non-Bambu printer", async () => {
      const octoprintPrinter = await createTestPrinter(request);

      const response = await request.post(uploadFileRoute(octoprintPrinter.id)).send();
      expectInvalidResponse(response);
    });
  });
});
