import { Test } from "supertest";
import { setupTestApp } from "../test-server";
import { expectInvalidResponse, expectOkResponse } from "../extensions";
import { AppConstants } from "@/server.constants";
import {
  credentialSettingsKey,
  frontendSettingKey,
  getDefaultFrontendSettings,
  getDefaultGridStatusColors,
  serverSettingsKey,
  timeoutSettingKey,
  wizardSettingKey,
} from "@/constants/server-settings.constants";
import { SettingsController } from "@/controllers/settings.controller";
import TestAgent from "supertest/lib/agent";
import { FrontendSettingsDto } from "@/services/interfaces/settings.dto";
import { SettingsStore } from "@/state/settings.store";
import { DITokens } from "@/container.tokens";

let request: TestAgent<Test>;
let settingsStore: SettingsStore;

const defaultRoute = `${AppConstants.apiRoute}/settings`;
const sensitiveSettingsRoute = `${defaultRoute}/sensitive`;
const credentialSettingsRoute = `${defaultRoute}/credential`;
const experimentalMoonrakerSupport = `${defaultRoute}/experimental-moonraker-support`;
const frontendSettingsRoute = `${defaultRoute}/frontend`;
const sentryDiagnosticsRoute = `${defaultRoute}/sentry-diagnostics`;
const slicerApiKeyRoute = `${defaultRoute}/slicer-api-key`;
const regenerateSlicerApiKeyRoute = `${slicerApiKeyRoute}/regenerate`;

beforeAll(async () => {
  const app = await setupTestApp(true);
  request = app.request;
  settingsStore = app.container.resolve<SettingsStore>(DITokens.settingsStore);
});

describe(SettingsController.name, () => {
  it("persists and disables grid colours without changing other settings or losing colours", async () => {
    const before = (await request.get(defaultRoute)).body.server;
    expect(before.gridStatusColorsEnabled).toBe(false);
    expect(before.gridStatusColors).toEqual(getDefaultGridStatusColors());
    const colors = { ...getDefaultGridStatusColors(), printing: "#123456" };
    const response = await request.put(`${defaultRoute}/grid-status-colors`).send({ enabled: true, colors });
    expectOkResponse(response);
    expect(response.body.server).toEqual({ ...before, gridStatusColorsEnabled: true, gridStatusColors: colors });
    await settingsStore.loadSettings();
    expect((await request.get(defaultRoute)).body.server.gridStatusColors).toEqual(colors);
    expect((await request.get(sensitiveSettingsRoute)).body.server.gridStatusColors).toEqual(colors);
    const disabled = await request.put(`${defaultRoute}/grid-status-colors`).send({ enabled: false });
    expectOkResponse(disabled);
    expect(disabled.body.server).toEqual({ ...before, gridStatusColors: colors });
  });

  it.each([
    {},
    { enabled: "true" },
    { enabled: true, colors: {} },
    ...["red", "#fff", "#12345678", "url(test)", null, 12].map((printing) => ({
      enabled: true,
      colors: { ...getDefaultGridStatusColors(), printing },
    })),
    { enabled: true, colors: { ...getDefaultGridStatusColors(), extra: "#000000" } },
  ])("rejects invalid grid colour settings %j", async (body) => {
    expectInvalidResponse(await request.put(`${defaultRoute}/grid-status-colors`).send(body));
  });

  it("defaults the status check off and persists it independently of assignment", async () => {
    const before = (await request.get(defaultRoute)).body.server;
    expect(before.checkPrinterStatusBeforePrint).toBe(false);
    expect(before.printAssignmentEnabled).toBe(false);
    const response = await request.put(`${defaultRoute}/pre-print-status-check`).send({ enabled: true });
    expectOkResponse(response);
    expect(response.body.server).toEqual({ ...before, checkPrinterStatusBeforePrint: true });
    await settingsStore.loadSettings();
    expect((await request.get(defaultRoute)).body.server.checkPrinterStatusBeforePrint).toBe(true);
    expect((await request.get(sensitiveSettingsRoute)).body.server.checkPrinterStatusBeforePrint).toBe(true);
    expectOkResponse(await request.put(`${defaultRoute}/pre-print-status-check`).send({ enabled: false }));
    expect((await request.get(defaultRoute)).body.server).toEqual(before);
  });

  it.each([{}, { enabled: "true" }, { enabled: null }])(
    "rejects invalid pre-print status settings %j",
    async (body) => {
      expectInvalidResponse(await request.put(`${defaultRoute}/pre-print-status-check`).send(body));
    },
  );

  it("defaults grid assignee display off and persists its independent toggle", async () => {
    const before = (await request.get(defaultRoute)).body.server;
    expect(before.showPrintAssigneeOnGrid).toBe(false);
    const response = await request.put(`${defaultRoute}/print-assignee-grid`).send({ enabled: true });
    expectOkResponse(response);
    expect(response.body.server).toEqual({ ...before, showPrintAssigneeOnGrid: true });
    await settingsStore.loadSettings();
    expect((await request.get(defaultRoute)).body.server.showPrintAssigneeOnGrid).toBe(true);
    expect((await request.get(sensitiveSettingsRoute)).body.server.showPrintAssigneeOnGrid).toBe(true);
    expectOkResponse(await request.put(`${defaultRoute}/print-assignee-grid`).send({ enabled: false }));
    expect((await request.get(defaultRoute)).body.server).toEqual(before);
  });

  it.each([{}, { enabled: "true" }, { enabled: null }])("rejects invalid grid assignee settings %j", async (body) => {
    expectInvalidResponse(await request.put(`${defaultRoute}/print-assignee-grid`).send(body));
  });

  it("should OK on GET settings", async () => {
    const response = await request.get(defaultRoute).send();

    expectOkResponse(response);
    const body = response.body;
    expect(body).not.toBeNull();

    expect(body[serverSettingsKey]).toMatchObject({
      sentryDiagnosticsEnabled: false,
      loginRequired: false,
      registration: false,
      experimentalMoonrakerSupport: true,
      advancedFileListEnabled: false,
      printAssignmentEnabled: false,
    });
    expect(body[wizardSettingKey]).toMatchObject({
      wizardCompleted: true,
      wizardVersion: AppConstants.currentWizardVersion,
    });
    expect(body[frontendSettingKey]).toMatchObject(getDefaultFrontendSettings());
    expect(body.connection).toMatchObject({
      clientIp: expect.any(String),
      version: expect.any(String),
    });
    expect(body[timeoutSettingKey]).toMatchObject({
      apiTimeout: 10000,
      apiUploadTimeout: 30000,
    });

    // Removed property
    expect(body[credentialSettingsKey]).toBeFalsy();
  });

  it("should OK on GET sensitive settings", async () => {
    const response = await request.get(sensitiveSettingsRoute).send();
    expect(response.body).not.toBeNull();
    expectOkResponse(response);
  });

  it("persists the independent print assignment toggle without changing advanced list settings", async () => {
    const before = (await request.get(defaultRoute)).body.server;
    const enabled = await request.put(`${defaultRoute}/print-assignment`).send({ enabled: true });
    expectOkResponse(enabled);
    expect(enabled.body.server).toEqual({ ...before, printAssignmentEnabled: true });
    await settingsStore.loadSettings();
    expect((await request.get(defaultRoute)).body.server.printAssignmentEnabled).toBe(true);
    expect((await request.get(sensitiveSettingsRoute)).body.server.printAssignmentEnabled).toBe(true);
    expectOkResponse(await request.put(`${defaultRoute}/print-assignment`).send({ enabled: false }));
    expect((await request.get(defaultRoute)).body.server).toEqual(before);
  });

  it.each([{}, { enabled: "true" }, { enabled: null }])(
    "rejects invalid print assignment settings %j",
    async (body) => {
      expectInvalidResponse(await request.put(`${defaultRoute}/print-assignment`).send(body));
    },
  );

  it("should OK on PUT experimental moonraker support setting", async () => {
    const response = await request.put(experimentalMoonrakerSupport).send({
      enabled: true,
    });
    expectOkResponse(response);
  });

  it("should persist and disable the advanced file list without changing other settings", async () => {
    const before = (await request.get(defaultRoute)).body;
    const enabled = await request.put(`${defaultRoute}/advanced-file-list`).send({ enabled: true });
    expectOkResponse(enabled);
    expect(enabled.body.server).toEqual({ ...before.server, advancedFileListEnabled: true });
    await settingsStore.loadSettings();
    expect((await request.get(defaultRoute)).body.server.advancedFileListEnabled).toBe(true);
    expect((await request.get(sensitiveSettingsRoute)).body.server.advancedFileListEnabled).toBe(true);

    const disabled = await request.put(`${defaultRoute}/advanced-file-list`).send({ enabled: false });
    expectOkResponse(disabled);
    expect(disabled.body.server).toEqual(before.server);
  });

  it.each([{}, { enabled: "true" }, { enabled: null }])(
    "should reject invalid advanced file list input %j",
    async (body) => {
      const response = await request.put(`${defaultRoute}/advanced-file-list`).send(body);
      expectInvalidResponse(response);
    },
  );

  it("should persist optional columns and preserve them when only the enable switch changes", async () => {
    const columns = { size: false, startedAt: false };
    const before = (await request.get(defaultRoute)).body.server;
    const response = await request.put(`${defaultRoute}/advanced-file-list`).send({ enabled: true, columns });
    expectOkResponse(response);
    expect(response.body.server).toEqual({
      ...before,
      advancedFileListEnabled: true,
      advancedFileListColumns: columns,
    });
    await settingsStore.loadSettings();
    expect((await request.get(defaultRoute)).body.server.advancedFileListColumns).toEqual(columns);
    expect((await request.get(sensitiveSettingsRoute)).body.server.advancedFileListColumns).toEqual(columns);
    const disabled = await request.put(`${defaultRoute}/advanced-file-list`).send({ enabled: false });
    expectOkResponse(disabled);
    expect(disabled.body.server.advancedFileListColumns).toEqual(columns);
    const restored = await request
      .put(`${defaultRoute}/advanced-file-list`)
      .send({ enabled: false, columns: { size: true, startedAt: true } });
    expectOkResponse(restored);
  });

  it.each([
    null,
    {},
    { size: true },
    { size: "false", startedAt: true },
    { size: true, startedAt: false, name: false },
    ["size"],
  ])("should reject invalid advanced file list columns %j", async (columns) => {
    const before = (await request.get(defaultRoute)).body.server;
    const response = await request.put(`${defaultRoute}/advanced-file-list`).send({ enabled: true, columns });
    expectInvalidResponse(response);
    expect((await request.get(defaultRoute)).body.server).toEqual(before);
  });

  it("should OK on PATCH sentry diagnostics ", async () => {
    const response = await request.patch(sentryDiagnosticsRoute).send({
      enabled: true,
    });
    expectOkResponse(response);
  });

  it("should OK on PUT frontend settings", async () => {
    const newFrontendSettings: FrontendSettingsDto = {
      gridCols: 6,
      gridRows: 6,
      largeTiles: false,
      tilePreferCancelOverQuickStop: false,
    };
    const response = await request.put(frontendSettingsRoute).send(newFrontendSettings);
    expect(response.body).not.toBeNull();
    expect(response.body).toMatchObject({
      [frontendSettingKey]: newFrontendSettings,
    });
    expectOkResponse(response);
  });

  it("should OK on PUT credentials settings", async () => {
    const newCredentialsSettings = {
      jwtExpiresIn: 120,
      refreshTokenAttempts: -1,
      refreshTokenExpiry: 3600,
    };

    const response = await request.put(credentialSettingsRoute).send(newCredentialsSettings);
    expect(response.body).toStrictEqual({});
    expectOkResponse(response);
  });

  it("should OK on PUT login-required", async () => {
    const response = await request.put(`${defaultRoute}/login-required`).send({
      loginRequired: false,
    });
    expectOkResponse(response);
  });

  it("should OK on PUT registration-enabled", async () => {
    const response = await request.put(`${defaultRoute}/registration-enabled`).send({
      registrationEnabled: true,
    });
    expectOkResponse(response);
  });

  it("should OK on PUT timeout", async () => {
    const response = await request.put(`${defaultRoute}/timeout`).send({
      apiTimeout: 1000,
      apiUploadTimeout: 10000,
    });
    expectOkResponse(response);
  });

  it("should not OK on PUT timeout which is too low", async () => {
    const response = await request.put(`${defaultRoute}/timeout`).send({
      apiTimeout: 1000,
      apiUploadTimeout: 9000,
    });
    expectInvalidResponse(response, [
      {
        path: "apiUploadTimeout",
        code: "too_small",
      },
    ]);
  });

  describe("Slicer API Key", () => {
    it("should return null slicerApiKey when none exists", async () => {
      const response = await request.get(slicerApiKeyRoute).send();
      expectOkResponse(response);
      expect(response.body).toMatchObject({
        slicerApiKey: null,
      });
    });

    it("should generate a new slicer API key", async () => {
      const response = await request.post(regenerateSlicerApiKeyRoute).send();
      expectOkResponse(response);
      expect(response.body).toHaveProperty("slicerApiKey");
      expect(response.body.slicerApiKey).toBeTruthy();
      expect(typeof response.body.slicerApiKey).toBe("string");
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(response.body.slicerApiKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("should return existing slicer API key after generation", async () => {
      // First generate a key
      const generateResponse = await request.post(regenerateSlicerApiKeyRoute).send();
      expectOkResponse(generateResponse);
      const generatedKey = generateResponse.body.slicerApiKey;

      // Then get the key
      const getResponse = await request.get(slicerApiKeyRoute).send();
      expectOkResponse(getResponse);
      expect(getResponse.body.slicerApiKey).toBe(generatedKey);
    });

    it("should regenerate a different slicer API key", async () => {
      // Generate first key
      const firstResponse = await request.post(regenerateSlicerApiKeyRoute).send();
      expectOkResponse(firstResponse);
      const firstKey = firstResponse.body.slicerApiKey;

      // Regenerate key
      const secondResponse = await request.post(regenerateSlicerApiKeyRoute).send();
      expectOkResponse(secondResponse);
      const secondKey = secondResponse.body.slicerApiKey;

      // Keys should be different
      expect(secondKey).not.toBe(firstKey);
    });

    it("should delete slicer API key", async () => {
      // First generate a key
      await request.post(regenerateSlicerApiKeyRoute).send();

      // Delete the key
      const deleteResponse = await request.delete(slicerApiKeyRoute).send();
      expectOkResponse(deleteResponse);
      expect(deleteResponse.body).toMatchObject({
        slicerApiKey: null,
      });

      // Verify it's deleted
      const getResponse = await request.get(slicerApiKeyRoute).send();
      expectOkResponse(getResponse);
      expect(getResponse.body.slicerApiKey).toBeNull();
    });
  });
});
