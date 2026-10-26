import type { Request, Response } from "express";
import { FloorStore } from "@/state/floor.store";
import { PERMS, ROLES } from "@/constants/authorization.constants";
import { AppConstants } from "@/server.constants";
import { before, DELETE, GET, PATCH, POST, PUT, route } from "awilix-express";
import { authenticate, authorizeRoles, permission } from "@/middleware/authenticate";
import { ParamId } from "@/middleware/param-converter.middleware";
import { validateInput } from "@/handlers/validators";
import { floorGridPasswordSchema, floorGridUnlockSchema } from "@/services/validators/floor-service.validation";
import { demoUserNotAllowed } from "@/middleware/demo.middleware";
import { SettingsStore } from "@/state/settings.store";
import { BadRequestException } from "@/exceptions/runtime.exceptions";

const unlockAttempts = new Map<string, { count: number; expiresAt: number }>();

@route(AppConstants.apiRoute + "/floor")
@before([authenticate()])
export class FloorController {
  constructor(
    private readonly floorStore: FloorStore,
    private readonly settingsStore: SettingsStore,
  ) {}

  @PUT()
  @route("/:id/grid-password")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed, ParamId("id")])
  async setGridPassword(req: Request, res: Response) {
    if (!this.settingsStore.getServerSettings().floorGridLockEnabled) {
      throw new BadRequestException("Enable floor grid locks in Quality of Life settings first");
    }
    const { password } = await validateInput(req.body, floorGridPasswordSchema);
    res.send(await this.floorStore.setGridPassword(req.local.id, password));
  }

  @POST()
  @route("/:id/grid-unlock")
  @before([permission(PERMS.Floors.Get), ParamId("id")])
  async unlockGrid(req: Request, res: Response) {
    const { password } = await validateInput(req.body, floorGridUnlockSchema);
    const now = Date.now();
    for (const [key, attempt] of unlockAttempts) {
      if (attempt.expiresAt <= now) unlockAttempts.delete(key);
    }
    const key = `${req.ip}:${req.local.id}`;
    const attempt = unlockAttempts.get(key) ?? { count: 0, expiresAt: now + 60000 };
    if (attempt.count >= 5) {
      res.setHeader("Retry-After", Math.ceil((attempt.expiresAt - now) / 1000));
      res.status(429).send({ message: "Too many password attempts. Wait a minute and try again." });
      return;
    }
    attempt.count++;
    unlockAttempts.set(key, attempt);
    const result = await this.floorStore.verifyGridPassword(req.local.id, password);
    if (result.unlocked) unlockAttempts.delete(key);
    res.send(result);
  }

  @GET()
  @route("/")
  @before([permission(PERMS.Floors.List)])
  async list(req: Request, res: Response) {
    const floors = await this.floorStore.listCache();
    res.send(floors);
  }

  @GET()
  @route("/:id")
  @before([permission(PERMS.Floors.Get), ParamId("id")])
  async get(req: Request, res: Response) {
    const floor = await this.floorStore.getFloor(req.local.id);
    res.send(floor);
  }

  @DELETE()
  @route("/:id")
  @before([permission(PERMS.Floors.Delete), ParamId("id")])
  async delete(req: Request, res: Response) {
    await this.floorStore.delete(req.local.id);
    res.send();
  }

  @POST()
  @route("/")
  @before([permission(PERMS.Floors.Create)])
  async create(req: Request, res: Response) {
    const floor = await this.floorStore.create(req.body);
    res.send(floor);
  }

  @PATCH()
  @route("/:id/name")
  @before([permission(PERMS.Floors.Update), ParamId("id")])
  async updateName(req: Request, res: Response) {
    const floor = await this.floorStore.updateName(req.local.id, req.body.name);
    res.send(floor);
  }

  @PATCH()
  @route("/:id/floor-order")
  @before([permission(PERMS.Floors.Update), ParamId("id")])
  async updateFloorOrder(req: Request, res: Response) {
    const floor = await this.floorStore.updateFloorOrder(req.local.id, req.body.order);
    res.send(floor);
  }

  @POST()
  @route("/:id/printer")
  @before([permission(PERMS.Floors.Update), ParamId("id")])
  async addPrinterToFloor(req: Request, res: Response) {
    const floor = await this.floorStore.addOrUpdatePrinter(req.local.id, req.body);
    res.send(floor);
  }

  @DELETE()
  @route("/:id/printer")
  @before([permission(PERMS.Floors.Update), ParamId("id")])
  async removePrinterFromFloor(req: Request, res: Response) {
    const floor = await this.floorStore.removePrinter(req.local.id, req.body.printerId);
    res.send(floor);
  }
}
