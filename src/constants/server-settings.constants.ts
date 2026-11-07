import { AppConstants } from "@/server.constants";
import {
  CredentialSettingsDto,
  FrontendSettingsDto,
  ServerSettingsDto,
  TimeoutSettingsDto,
  WizardSettingsDto,
} from "@/services/interfaces/settings.dto";
import { v4 as uuidv4 } from "uuid";
import type { UserDirectoryConfig } from "@/services/interfaces/user-directory.dto";

export const wizardSettingKey = "wizard";
export const getDefaultWizardSettings = (): WizardSettingsDto => ({
  wizardCompleted: false,
  wizardCompletedAt: null,
  wizardVersion: 0,
});

export const serverSettingsKey = "server";
export const getDefaultAdvancedFileListColumns = () => ({ size: true, startedAt: true });
export const getDefaultGridStatusColors = () => ({
  ready: "#2E7D32",
  printing: "#1565C0",
  paused: "#FFB300",
  offline: "#616161",
  connecting: "#7B1FA2",
  error: "#C62828",
  disabled: "#303030",
  maintenance: "#EF6C00",
});
export const getDefaultUserDirectoryConfig = (): UserDirectoryConfig => ({
  enabled: false,
  allowManualEntry: true,
  endpoint: "",
  method: "GET",
  authMode: "none",
  credentialPlacement: "form",
  clientId: "",
  clientIdField: "client_id",
  clientSecretField: "client_secret",
  tokenEndpoint: "",
  tokenCredentialPlacement: "form",
  scope: "",
  accessTokenPath: "access_token",
  tokenTypePath: "token_type",
  usersPath: "users",
  namePath: "name",
  emailPath: "email",
  paginationEnabled: false,
  pageNumberParameter: "page_number",
  pageSizeParameter: "page_size",
  pageSize: 50,
  countPath: "count",
  pageNumberPath: "page_number",
  pageSizePath: "page_size",
  combineNames: false,
  firstNamePath: "first_name",
  lastNamePath: "last_name",
});
export const getDefaultServerSettings = (): ServerSettingsDto => ({
  sentryDiagnosticsEnabled: false,
  loginRequired: true,
  registration: false,
  experimentalMoonrakerSupport: false,
  experimentalBambuSupport: false,
  experimentalPrusaLinkSupport: false,
  advancedFileListEnabled: false,
  printAssignmentEnabled: false,
  showPrintAssigneeOnGrid: false,
  checkPrinterStatusBeforePrint: false,
  gridStatusColorsEnabled: false,
  floorGridLockEnabled: false,
  floorGridIdleTimeoutMinutes: 0,
  userDirectoryApi: getDefaultUserDirectoryConfig(),
  gridStatusColors: getDefaultGridStatusColors(),
  advancedFileListColumns: getDefaultAdvancedFileListColumns(),
});

export const credentialSettingsKey = "credentials";
export const getDefaultCredentialSettings = (): CredentialSettingsDto => ({
  // Signing only, verification is automatic
  jwtExpiresIn: AppConstants.DEFAULT_JWT_EXPIRES_IN,
  // Verification only, bringing into effect requires updating all stored refresh tokens
  refreshTokenAttempts: AppConstants.DEFAULT_REFRESH_TOKEN_ATTEMPTS,
  // Verification only, bringing into effect requires updating all stored refresh tokens
  refreshTokenExpiry: AppConstants.DEFAULT_REFRESH_TOKEN_EXPIRY,
  // API key for slicer integration (PrusaSlicer, etc.)
  slicerApiKey: null,
});

export const frontendSettingKey = "frontend";
export const getDefaultFrontendSettings = (): FrontendSettingsDto => ({
  gridCols: 4,
  gridRows: 2,
  largeTiles: false,
  tilePreferCancelOverQuickStop: false,
  gridNameSortDirection: "horizontal",
});

export const timeoutSettingKey = "timeout";
export const getDefaultTimeout = (): TimeoutSettingsDto => ({
  apiTimeout: 10000,
  apiUploadTimeout: 30000,
});

export const getDefaultSettings = () => ({
  [serverSettingsKey]: getDefaultServerSettings(),
  [wizardSettingKey]: getDefaultWizardSettings(),
  [credentialSettingsKey]: {
    ...getDefaultCredentialSettings(),
    jwtSecret: uuidv4(),
  },
  [frontendSettingKey]: getDefaultFrontendSettings(),
  [timeoutSettingKey]: getDefaultTimeout(),
});
