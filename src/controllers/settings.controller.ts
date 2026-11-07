import { DELETE, GET, PATCH, POST, PUT, route, before } from "awilix-express";
import { authenticate, authorizeRoles, permission } from "@/middleware/authenticate";
import { AppConstants } from "@/server.constants";
import { PERMS, ROLES } from "@/constants/authorization.constants";
import { validateInput } from "@/handlers/validators";
import {
  credentialCoreSettingUpdateSchema,
  frontendSettingsUpdateSchema,
  moonrakerSupportSchema,
  prusaLinkSupportSchema,
  sentryDiagnosticsEnabledSchema,
  timeoutSettingsUpdateSchema,
  bambuSupportSchema,
  advancedFileListSchema,
  printAssignmentSettingsSchema,
  gridStatusColorSettingsSchema,
  floorGridLockSettingsSchema,
  userDirectorySettingsUpdateSchema,
} from "@/services/validators/settings-service.validation";
import { SettingsStore } from "@/state/settings.store";
import type { Request, Response } from "express";
import type { ILoggerFactory } from "@/handlers/logger-factory";
import { LoggerService } from "@/handlers/logger";
import { demoUserNotAllowed } from "@/middleware/demo.middleware";
import { PrinterCache } from "@/state/printer.cache";
import { BambuType, PrusaLinkType, MoonrakerType } from "@/services/printer-api.interface";
import type { IPrinterService } from "@/services/interfaces/printer.service.interface";
import { PrinterThumbnailCache } from "@/state/printer-thumbnail.cache";
import { loginRequiredSchema, registrationEnabledSchema } from "@/controllers/validation/setting.validation";
import { UserDirectoryService } from "@/services/user-directory.service";

@route(AppConstants.apiRoute + "/settings")
@before([authenticate()])
export class SettingsController {
  private readonly logger: LoggerService;

  constructor(
    loggerFactory: ILoggerFactory,
    private readonly serverVersion: string,
    private readonly printerCache: PrinterCache,
    private readonly printerService: IPrinterService,
    private readonly settingsStore: SettingsStore,
    private readonly printerThumbnailCache: PrinterThumbnailCache,
    private readonly userDirectoryService: UserDirectoryService,
  ) {
    this.logger = loggerFactory(SettingsController.name);
  }

  @GET()
  @route("/")
  async getSettings(req: Request, res: Response) {
    let connection;
    try {
      connection = {
        clientIp: req.socket?.remoteAddress,
        version: this.serverVersion,
      };
    } catch (e) {
      this.logger.warn("Could not fetch server IP address");
    }
    const settings = this.settingsStore.getSettings();
    res.send({ ...settings, connection });
  }

  @GET()
  @route("/sensitive")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async getSettingsSensitive(req: Request, res: Response) {
    const settings = this.settingsStore.getSettingsSensitive();
    res.send(settings);
  }

  @PATCH()
  @route("/sentry-diagnostics")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateSentryDiagnosticsEnabled(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, sentryDiagnosticsEnabledSchema);
    const result = this.settingsStore.setSentryDiagnosticsEnabled(enabled);
    res.send(result);
  }

  @PUT()
  @route("/experimental-moonraker-support")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateMoonrakerSupport(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, moonrakerSupportSchema);
    const result = await this.settingsStore.setExperimentalMoonrakerSupport(enabled);

    if (!enabled) {
      const printers = await this.printerCache.listCachedPrinters(false);
      const klipperPrinters = printers.filter((p) => p.printerType === MoonrakerType);
      for (const printer of klipperPrinters) {
        await this.printerService.updateEnabled(printer.id, false);
      }
    }
    res.send(result);
  }

  @PUT()
  @route("/experimental-prusa-link-support")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updatePrusaLinkSupport(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, prusaLinkSupportSchema);
    const result = await this.settingsStore.setExperimentalPrusaLinkSupport(enabled);

    if (!enabled) {
      const printers = await this.printerCache.listCachedPrinters(false);
      const prusaLinkPrinters = printers.filter((p) => p.printerType === PrusaLinkType);
      for (const printer of prusaLinkPrinters) {
        await this.printerService.updateEnabled(printer.id, false);
      }
    }
    res.send(result);
  }

  @PUT()
  @route("/experimental-bambu-support")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateBambuSupport(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, bambuSupportSchema);
    const result = await this.settingsStore.setExperimentalBambuSupport(enabled);

    if (!enabled) {
      const printers = await this.printerCache.listCachedPrinters(false);
      const bambuPrinters = printers.filter((p) => p.printerType === BambuType);
      for (const printer of bambuPrinters) {
        await this.printerService.updateEnabled(printer.id, false);
      }
    }
    res.send(result);
  }

  @PUT()
  @route("/advanced-file-list")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateAdvancedFileList(req: Request, res: Response) {
    const update = await validateInput(req.body, advancedFileListSchema);
    const result = await this.settingsStore.updateAdvancedFileList(update);
    res.send(result);
  }

  @PUT()
  @route("/print-assignment")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updatePrintAssignment(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, printAssignmentSettingsSchema);
    res.send(await this.settingsStore.setPrintAssignmentEnabled(enabled));
  }

  @PUT()
  @route("/print-assignee-grid")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updatePrintAssigneeGrid(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, printAssignmentSettingsSchema);
    res.send(await this.settingsStore.setShowPrintAssigneeOnGrid(enabled));
  }

  @PUT()
  @route("/pre-print-status-check")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updatePrePrintStatusCheck(req: Request, res: Response) {
    const { enabled } = await validateInput(req.body, printAssignmentSettingsSchema);
    res.send(await this.settingsStore.setCheckPrinterStatusBeforePrint(enabled));
  }

  @PUT()
  @route("/grid-status-colors")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateGridStatusColors(req: Request, res: Response) {
    const data = await validateInput(req.body, gridStatusColorSettingsSchema);
    res.send(await this.settingsStore.setGridStatusColors(data));
  }

  @PUT()
  @route("/floor-grid-lock")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateFloorGridLock(req: Request, res: Response) {
    const { enabled, idleTimeoutMinutes } = await validateInput(req.body, floorGridLockSettingsSchema);
    res.send(await this.settingsStore.setFloorGridLockEnabled(enabled, idleTimeoutMinutes));
  }

  @GET()
  @route("/user-directory")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async getUserDirectorySettings(req: Request, res: Response) {
    res.send(this.settingsStore.getUserDirectorySettings());
  }

  @PUT()
  @route("/user-directory")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateUserDirectorySettings(req: Request, res: Response) {
    const update = await validateInput(req.body, userDirectorySettingsUpdateSchema);
    const result = await this.settingsStore.setUserDirectorySettings(
      update.config,
      update.clientSecret,
      update.clearClientSecret,
    );
    this.userDirectoryService.invalidateCache();
    res.send(result);
  }

  @POST()
  @route("/user-directory/test")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async testUserDirectoryConnection(req: Request, res: Response) {
    res.send(await this.userDirectoryService.testConnection());
  }

  @POST()
  @route("/user-directory/refresh")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async refreshUserDirectory(req: Request, res: Response) {
    const users = await this.userDirectoryService.listUsers(true);
    res.send({ success: true, userCount: users.length });
  }

  @GET()
  @route("/user-directory/users")
  @before(permission(PERMS.PrinterFiles.Actions))
  async getUserDirectoryUsers(req: Request, res: Response) {
    if (!this.settingsStore.getServerSettings().printAssignmentEnabled) {
      res.sendStatus(404);
      return;
    }
    res.send(await this.userDirectoryService.listUsers());
  }

  @PUT()
  @route("/frontend")
  @before([authorizeRoles([ROLES.ADMIN])])
  async updateFrontendSettings(req: Request, res: Response) {
    const validatedInput = await validateInput(req.body, frontendSettingsUpdateSchema);
    const result = await this.settingsStore.updateFrontendSettings(validatedInput);
    res.send(result);
  }

  @PUT()
  @route("/login-required")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateLoginRequiredSettings(req: Request, res: Response) {
    const { loginRequired } = await validateInput(req.body, loginRequiredSchema);
    const result = await this.settingsStore.setLoginRequired(loginRequired);
    res.send(result);
  }

  @PUT()
  @route("/registration-enabled")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateRegistrationEnabledSettings(req: Request, res: Response) {
    const { registrationEnabled } = await validateInput(req.body, registrationEnabledSchema);
    const result = await this.settingsStore.setRegistrationEnabled(registrationEnabled);
    res.send(result);
  }

  @PUT()
  @route("/credential")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateCredentialSettings(req: Request, res: Response) {
    const validatedInput = await validateInput(req.body, credentialCoreSettingUpdateSchema);
    await this.settingsStore.updateCoreCredentialSettings(validatedInput);
    res.send();
  }

  @PUT()
  @route("/timeout")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async updateTimeoutSettings(req: Request, res: Response) {
    const validatedInput = await validateInput(req.body, timeoutSettingsUpdateSchema);
    const result = await this.settingsStore.updateTimeoutSettings(validatedInput);
    res.send(result);
  }

  @GET()
  @route("/slicer-api-key")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async getSlicerApiKey(req: Request, res: Response) {
    const apiKey = this.settingsStore.getSlicerApiKey();
    res.send({ slicerApiKey: apiKey });
  }

  @POST()
  @route("/slicer-api-key/regenerate")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async regenerateSlicerApiKey(req: Request, res: Response) {
    const newApiKey = await this.settingsStore.generateSlicerApiKey();
    this.logger.log("Slicer API key regenerated");
    res.send({ slicerApiKey: newApiKey });
  }

  @DELETE()
  @route("/slicer-api-key")
  @before([authorizeRoles([ROLES.ADMIN]), demoUserNotAllowed])
  async deleteSlicerApiKey(req: Request, res: Response) {
    await this.settingsStore.deleteSlicerApiKey();
    this.logger.log("Slicer API key deleted");
    res.send({ slicerApiKey: null });
  }
}
