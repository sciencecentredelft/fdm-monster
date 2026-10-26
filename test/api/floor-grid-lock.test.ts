import { setupTestApp } from "../test-server";
import { createTestFloor } from "./test-data/create-floor";
import { DITokens } from "@/container.tokens";
import { SettingsStore } from "@/state/settings.store";
import { FloorStore } from "@/state/floor.store";
import { Floor } from "@/entities";
import { getDatasource } from "../typeorm.manager";
import { expectInvalidResponse, expectOkResponse } from "../extensions";
import { ensureTestUserCreated } from "./test-data/create-user";
import { ROLES } from "@/constants/authorization.constants";

describe("floor grid convenience locks", () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>;
  let settings: SettingsStore;
  const route = "/api/v2/floor";
  beforeAll(async () => {
    app = await setupTestApp(true);
    settings = app.container.resolve<SettingsStore>(DITokens.settingsStore);
  });

  it("defaults off and persists the independent setting", async () => {
    expect(settings.getServerSettings().floorGridLockEnabled).toBe(false);
    const response = await app.request.put("/api/v2/settings/floor-grid-lock").send({ enabled: true });
    expectOkResponse(response);
    await settings.loadSettings();
    expect(settings.getServerSettings().floorGridLockEnabled).toBe(true);
    expect(settings.getSettingsSensitive().server.floorGridLockEnabled).toBe(true);
  });

  it.each([{}, { enabled: "true" }, { enabled: null }])("rejects invalid toggle %j", async (body) => {
    expectInvalidResponse(await app.request.put("/api/v2/settings/floor-grid-lock").send(body));
  });

  it("hashes passwords, never serializes them, and verifies exact passwords", async () => {
    const floor = await createTestFloor(app.request, "Protected group", 1);
    const response = await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: "group-password" });
    expectOkResponse(response);
    expect(response.body.gridProtected).toBe(true);
    expect(response.body.gridPasswordHash).toBeUndefined();
    const entity = await getDatasource()
      .getRepository(Floor)
      .createQueryBuilder("floor")
      .addSelect("floor.gridPasswordHash")
      .where("floor.id = :id", { id: floor.id })
      .getOneOrFail();
    expect(entity.gridPasswordHash).not.toBe("group-password");
    expect(entity.gridPasswordHash).toMatch(/^\$2/);
    expect(
      (await getDatasource().getRepository(Floor).findOneByOrFail({ id: floor.id })).gridPasswordHash,
    ).toBeUndefined();
    const list = await app.request.get(route);
    expect(JSON.stringify(list.body)).not.toContain(entity.gridPasswordHash);
    expect(JSON.stringify(await app.container.resolve<FloorStore>(DITokens.floorStore).listCache())).not.toContain(
      entity.gridPasswordHash,
    );
    expect((await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "wrong" })).body.unlocked).toBe(
      false,
    );
    const unlocked = await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "group-password" });
    expectOkResponse(unlocked);
    expect(unlocked.body).toEqual({ unlocked: true, gridLockVersion: response.body.gridLockVersion });
    // Convenience lock: the normal floor API remains available without an unlock grant.
    expectOkResponse(await app.request.get(`${route}/${floor.id}`));
    const changed = await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: "new-password" });
    expect(changed.body.gridLockVersion).not.toBe(response.body.gridLockVersion);
    expect(
      (await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "group-password" })).body.unlocked,
    ).toBe(false);
    const removed = await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: null });
    expect(removed.body.gridProtected).toBe(false);
    expect(removed.body.gridLockVersion).toBeNull();
  });

  it.each(["short", " ".repeat(8), "a".repeat(73), "é".repeat(37), 123])(
    "rejects invalid password %j",
    async (password) => {
      const floor = await createTestFloor(app.request, "Validation group", 1);
      expectInvalidResponse(await app.request.put(`${route}/${floor.id}/grid-password`).send({ password }));
    },
  );

  it("limits failed attempts and recovers after the time window", async () => {
    const floor = await createTestFloor(app.request, "Limited group", 1);
    await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: "group-password" });
    for (let i = 0; i < 5; i++) {
      expectOkResponse(await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "wrong" }));
    }
    const response = await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "group-password" });
    expect(response.status).toBe(429);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61000);
    try {
      const success = await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "group-password" });
      expect(success.body.unlocked).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("preserves configured passwords while the master setting is disabled", async () => {
    const floor = await createTestFloor(app.request, "Preserved group", 1);
    await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: "group-password" });
    await settings.setFloorGridLockEnabled(false);
    expectInvalidResponse(
      await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: "other-password" }),
    );
    await settings.setFloorGridLockEnabled(true);
    expect(
      (await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "group-password" })).body.unlocked,
    ).toBe(true);
  });

  it("allows an operator to verify a password but not to change protection or its master setting", async () => {
    const floor = await createTestFloor(app.request, "Role-tested group", 1);
    await app.request.put(`${route}/${floor.id}/grid-password`).send({ password: "group-password" });
    await ensureTestUserCreated("grid-operator", "operator-password", false, ROLES.OPERATOR, true, false);
    await settings.setLoginRequired(true);
    try {
      const login = await app.request.post("/api/v2/auth/login").send({
        username: "grid-operator",
        password: "operator-password",
      });
      expectOkResponse(login);
      const authorization = `Bearer ${login.body.token}`;
      const verify = await app.request
        .post(`${route}/${floor.id}/grid-unlock`)
        .set("Authorization", authorization)
        .send({ password: "group-password" });
      expectOkResponse(verify);
      expect(verify.body.unlocked).toBe(true);
      expect(
        (
          await app.request
            .put(`${route}/${floor.id}/grid-password`)
            .set("Authorization", authorization)
            .send({ password: null })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request
            .put("/api/v2/settings/floor-grid-lock")
            .set("Authorization", authorization)
            .send({ enabled: false })
        ).status,
      ).toBe(403);
      expect(
        (await app.request.post(`${route}/${floor.id}/grid-unlock`).send({ password: "group-password" })).status,
      ).toBe(401);
    } finally {
      await settings.setLoginRequired(false);
    }
  });
});
