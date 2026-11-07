import { isProductionEnvironment } from "@/utils/env.utils";
import { z } from "zod";
import type { UserDirectoryConfig } from "@/services/interfaces/user-directory.dto";

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

const floorGridIdleTimeoutMinutesSchema = z.number().int().safe().min(0);

const jsonPathSchema = z
  .string()
  .refine((value) => /^(?:[A-Za-z0-9_-]+|\[\d+\])(?:\.(?:[A-Za-z0-9_-]+)|\[\d+\])*$/.test(value.replace(/^\$\.?/, "")));
const endpointSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
    } catch {
      return false;
    }
  }, "Endpoint must be an HTTP(S) URL without embedded credentials or a fragment");

export const userDirectoryConfigSchema = z
  .object({
    enabled: z.boolean(),
    allowManualEntry: z.boolean().default(true),
    endpoint: endpointSchema,
    method: z.enum(["GET", "POST"]),
    authMode: z.enum(["none", "credentials", "oauth2"]),
    credentialPlacement: z.enum(["header", "query", "json", "form"]),
    clientId: z.string().max(512),
    clientIdField: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    clientSecretField: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    tokenEndpoint: endpointSchema,
    tokenCredentialPlacement: z.enum(["basic", "json", "form"]),
    scope: z.string().max(512),
    accessTokenPath: jsonPathSchema,
    tokenTypePath: jsonPathSchema,
    usersPath: jsonPathSchema,
    namePath: jsonPathSchema,
    emailPath: jsonPathSchema,
    paginationEnabled: z.boolean().default(false),
    pageNumberParameter: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,128}$/)
      .default("page_number"),
    pageSizeParameter: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,128}$/)
      .default("page_size"),
    pageSize: z.number().int().min(1).max(1000).default(50),
    countPath: jsonPathSchema.default("count"),
    pageNumberPath: jsonPathSchema.default("page_number"),
    pageSizePath: jsonPathSchema.default("page_size"),
    combineNames: z.boolean().default(false),
    firstNamePath: jsonPathSchema.default("first_name"),
    lastNamePath: jsonPathSchema.default("last_name"),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.paginationEnabled) {
      if (config.method !== "GET") {
        context.addIssue({ code: "custom", path: ["method"], message: "Numbered pagination requires GET requests" });
      }
      if (
        config.pageNumberParameter === config.pageSizeParameter ||
        (config.authMode === "credentials" &&
          config.credentialPlacement === "query" &&
          [config.clientIdField, config.clientSecretField].some((field) =>
            [config.pageNumberParameter, config.pageSizeParameter].includes(field),
          ))
      ) {
        context.addIssue({
          code: "custom",
          path: ["pageNumberParameter"],
          message: "Pagination parameter names must be distinct and must not overwrite credentials",
        });
      }
    }
    if (config.enabled && !config.endpoint) {
      context.addIssue({
        code: "custom",
        path: ["endpoint"],
        message: "Users endpoint is required when the API is enabled",
      });
    }
    if (config.enabled && config.authMode !== "none" && !config.clientId.trim()) {
      context.addIssue({
        code: "custom",
        path: ["clientId"],
        message: "Client ID is required for this authentication mode",
      });
    }
    if (
      config.enabled &&
      config.authMode === "credentials" &&
      ["json", "form"].includes(config.credentialPlacement) &&
      config.method !== "POST"
    ) {
      context.addIssue({
        code: "custom",
        path: ["method"],
        message: "POST is required when credentials are sent in the request body",
      });
    }
    if (config.enabled && config.authMode === "oauth2" && !config.tokenEndpoint) {
      context.addIssue({ code: "custom", path: ["tokenEndpoint"], message: "Token endpoint is required for OAuth2" });
    }
  }) satisfies z.ZodType<UserDirectoryConfig>;

export const userDirectorySettingsUpdateSchema = z
  .object({
    config: userDirectoryConfigSchema,
    clientSecret: z.string().min(1).max(4096).optional(),
    clearClientSecret: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !(value.clientSecret && value.clearClientSecret), {
    message: "Provide a new client secret or clear the saved secret, not both",
  });

export const userDirectorySecretSchema = z.string().min(1).max(4096);

export const floorGridLockSettingsSchema = z
  .object({
    enabled: z.boolean(),
    idleTimeoutMinutes: floorGridIdleTimeoutMinutesSchema.optional(),
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
  floorGridIdleTimeoutMinutes: floorGridIdleTimeoutMinutesSchema.optional(),
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
