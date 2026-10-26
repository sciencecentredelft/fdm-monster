import { setupTestApp } from "../test-server";
import { DITokens } from "@/container.tokens";
import { SettingsStore } from "@/state/settings.store";
import { ROLES } from "@/constants/authorization.constants";
import { ensureTestUserCreated } from "./test-data/create-user";
import { createTestFloor } from "./test-data/create-floor";
import { createTestPrinter } from "./test-data/create-printer";
import { expectOkResponse } from "../extensions";
import nock from "nock";

describe("admin-only configuration", () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>;
  let settings: SettingsStore;
  let operator: string;
  let admin: string;
  let floorId: number;
  let printerId: number;

  beforeAll(async () => {
    app = await setupTestApp(true);
    settings = app.container.resolve<SettingsStore>(DITokens.settingsStore);
    floorId = (await createTestFloor(app.request)).id;
    printerId = (await createTestPrinter(app.request)).id;
    await ensureTestUserCreated("settings-operator", "test-password", false, ROLES.OPERATOR, true, false);
    await ensureTestUserCreated("settings-admin", "test-password", false, ROLES.ADMIN, true, false);
    await settings.setLoginRequired(true);
    for (const username of ["settings-operator", "settings-admin"]) {
      const response = await app.request.post("/api/v2/auth/login").send({ username, password: "test-password" });
      expectOkResponse(response);
      const authorization = `Bearer ${response.body.token}`;
      if (username === "settings-operator") operator = authorization;
      else admin = authorization;
    }
  });

  afterAll(async () => {
    await settings.setLoginRequired(false);
  });

  const settingWrites = [
    ["patch", "sentry-diagnostics"],
    ["put", "experimental-moonraker-support"],
    ["put", "experimental-prusa-link-support"],
    ["put", "experimental-bambu-support"],
    ["put", "advanced-file-list"],
    ["put", "print-assignment"],
    ["put", "print-assignee-grid"],
    ["put", "pre-print-status-check"],
    ["put", "grid-status-colors"],
    ["put", "floor-grid-lock"],
    ["put", "frontend"],
    ["put", "login-required"],
    ["put", "registration-enabled"],
    ["put", "credential"],
    ["put", "timeout"],
    ["post", "slicer-api-key/regenerate"],
    ["delete", "slicer-api-key"],
  ] as const;

  it.each(settingWrites)("rejects operator %s settings/%s", async (method, path) => {
    const response = await app.request[method](`/api/v2/settings/${path}`).set("Authorization", operator).send({});
    expect(response.status).toBe(403);
  });

  const configurationWrites = [
    ["post", "floor"],
    ["patch", "floor/:floor/name"],
    ["patch", "floor/:floor/floor-order"],
    ["post", "floor/:floor/printer"],
    ["delete", "floor/:floor/printer"],
    ["delete", "floor/:floor"],
    ["put", "floor/:floor/grid-password"],
    ["post", "printer"],
    ["post", "printer/batch"],
    ["patch", "printer/:printer"],
    ["delete", "printer/:printer"],
    ["patch", "printer/:printer/enabled"],
    ["patch", "printer/:printer/disabled-reason"],
    ["post", "printer/test-connection"],
    ["post", "printer-settings/:printer/sync-printername"],
    ["post", "batch/toggle-enabled"],
    ["post", "printer-tag"],
    ["patch", "printer-tag/1/name"],
    ["patch", "printer-tag/1/color"],
    ["delete", "printer-tag/1"],
    ["post", "printer-tag/1/printer"],
    ["delete", "printer-tag/1/printer"],
    ["post", "camera-stream"],
    ["put", "camera-stream/1"],
    ["delete", "camera-stream/1"],
  ] as const;

  it.each(configurationWrites)("rejects operator %s %s", async (method, path) => {
    const url = path.replace(":floor", `${floorId}`).replace(":printer", `${printerId}`);
    const response = await app.request[method](`/api/v2/${url}`).set("Authorization", operator).send({});
    expect(response.status).toBe(403);
  });

  it("keeps configuration reads and print workflows available to operators", async () => {
    for (const path of ["settings", "floor", `floor/${floorId}`, "printer", "printer-tag", "camera-stream"]) {
      expectOkResponse(await app.request.get(`/api/v2/${path}`).set("Authorization", operator));
    }
    for (const path of ["batch/reprint/list", "batch/reprint/execute", "batch/connect/usb", "batch/connect/socket"]) {
      const response = await app.request.post(`/api/v2/${path}`).set("Authorization", operator).send({});
      expect(response.status).toBe(400);
    }
    for (const command of ["pause", "resume", "cancel"]) {
      const printerRequest = nock("http://url.com").post("/api/job").reply(204);
      expectOkResponse(
        await app.request.post(`/api/v2/printer/${printerId}/job/${command}`).set("Authorization", operator),
      );
      expect(printerRequest.isDone()).toBe(true);
    }
    const connection = nock("http://url.com").post("/api/connection").reply(204);
    expectOkResponse(
      await app.request.post(`/api/v2/printer/${printerId}/serial-connect`).set("Authorization", operator),
    );
    expect(connection.isDone()).toBe(true);
  });

  it("allows administrators to save settings and manage floors", async () => {
    expectOkResponse(
      await app.request.put("/api/v2/settings/floor-grid-lock").set("Authorization", admin).send({ enabled: true }),
    );
    const created = await app.request
      .post("/api/v2/floor")
      .set("Authorization", admin)
      .send({ name: "Admin managed", order: 2, printers: [] });
    expectOkResponse(created);
    const id = created.body.id;
    expectOkResponse(
      await app.request.patch(`/api/v2/floor/${id}/name`).set("Authorization", admin).send({ name: "Renamed" }),
    );
    expectOkResponse(
      await app.request.patch(`/api/v2/floor/${id}/floor-order`).set("Authorization", admin).send({ order: 3 }),
    );
    expectOkResponse(
      await app.request.post(`/api/v2/floor/${id}/printer`).set("Authorization", admin).send({ printerId, x: 0, y: 0 }),
    );
    expectOkResponse(
      await app.request.delete(`/api/v2/floor/${id}/printer`).set("Authorization", admin).send({ printerId }),
    );
    expectOkResponse(await app.request.delete(`/api/v2/floor/${id}`).set("Authorization", admin));
    expectOkResponse(await app.request.get(`/api/v2/floor/${floorId}`).set("Authorization", operator));
  });

  it("reports the effective role when login is disabled", async () => {
    await settings.setLoginRequired(false);
    try {
      const response = await app.request.get("/api/v2/user/profile");
      expectOkResponse(response);
      expect(response.body.roles).toEqual([ROLES.ADMIN]);
    } finally {
      await settings.setLoginRequired(true);
    }
  });
});
