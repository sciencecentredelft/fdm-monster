import { isProductionEnvironment } from "@/utils/env.utils";
import { z } from "zod";

export const advancedFileListColumnsSchema = z
  .object({
    size: z.boolean(),
    startedAt: z.boolean(),
    assignedTo: z.boolean().optional(),
  })
  .strict();

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const gridStatusColorsSchema = z
  .object({
    ready: hexColorSchema,
    printing: hexColorSchema,
    paused: hexColorSchema,
    offline: hexColorSchema,
    connecting: hexColorSchema,
    error: hexColorSchema,
    disabled: hexColorSchema,
    maintenance: hexColorSchema,
  })
  .strict();

export const gridStatusColorSettingsSchema = z
  .object({
    enabled: z.boolean(),
    colors: gridStatusColorsSchema.optional(),
  })
  .strict();

export const serverSettingsUpdateSchema = z.object({
  registration: z.boolean(),
  loginRequired: z.boolean(),
  experimentalMoonrakerSupport: z.boolean(),
  experimentalBambuSupport: z.boolean(),
  experimentalPrusaLinkSupport: z.boolean(),
  sentryDiagnosticsEnabled: z.boolean(),
  advancedFileListEnabled: z.boolean().optional(),
  printAssignmentEnabled: z.boolean().optional(),
  showPrintAssigneeOnGrid: z.boolean().optional(),
  checkPrinterStatusBeforePrint: z.boolean().optional(),
  gridStatusColorsEnabled: z.boolean().optional(),
  floorGridLockEnabled: z.boolean().optional(),
  gridStatusColors: gridStatusColorsSchema.optional(),
  advancedFileListColumns: advancedFileListColumnsSchema.optional(),
});

export const advancedFileListSchema = z.object({
  enabled: z.boolean(),
  columns: advancedFileListColumnsSchema.optional(),
});

export const printAssignmentSettingsSchema = z.object({
  enabled: z.boolean(),
});

export const timeoutSettingsUpdateSchema = z.object({
  apiTimeout: z.number().int().min(1000),
  apiUploadTimeout: z.number().int().min(10000),
});

export const frontendSettingsUpdateSchema = z.object({
  gridCols: z.number().int().min(1),
  gridRows: z.number().int().min(1),
  largeTiles: z.boolean(),
  tilePreferCancelOverQuickStop: z.boolean(),
  gridNameSortDirection: z.enum(["horizontal", "vertical"]).optional(),
});

export const jwtSecretCredentialSettingUpdateSchema = z.object({
  jwtSecret: z.string().min(10),
});

export const credentialSettingSchema = z.object({
  jwtExpiresIn: z
    .number()
    .int()
    .min(isProductionEnvironment() ? 120 : 0)
    .max(isProductionEnvironment() ? 7200 : Infinity),
  refreshTokenAttempts: z.number().int().min(-1),
  refreshTokenExpiry: z
    .number()
    .int()
    .min(isProductionEnvironment() ? 240 : 0),
  slicerApiKey: z.string().nullable(),
});

export const credentialCoreSettingUpdateSchema = z.object({
  jwtExpiresIn: z
    .number()
    .int()
    .min(isProductionEnvironment() ? 120 : 0)
    .max(isProductionEnvironment() ? 7200 : Infinity),
  refreshTokenAttempts: z.number().int().min(-1),
  refreshTokenExpiry: z
    .number()
    .int()
    .min(isProductionEnvironment() ? 240 : 0),
});

export const slicerApiKeyUpdateSchema = z.object({
  slicerApiKey: z.string().nullable(),
});

export const wizardUpdateSchema = z.object({
  wizardCompleted: z.boolean(),
  wizardCompletedAt: z.date().nullable(),
  wizardVersion: z.number().int().min(0),
});

export const sentryDiagnosticsEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const moonrakerSupportSchema = z.object({
  enabled: z.boolean(),
});

export const prusaLinkSupportSchema = z.object({
  enabled: z.boolean(),
});

export const bambuSupportSchema = z.object({
  enabled: z.boolean(),
});
