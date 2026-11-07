export type UserDirectoryAuthMode = "none" | "credentials" | "oauth2";
export type UserDirectoryCredentialPlacement = "header" | "query" | "json" | "form";
export type UserDirectoryTokenPlacement = "basic" | "json" | "form";

export interface UserDirectoryConfig {
  enabled: boolean;
  allowManualEntry: boolean;
  endpoint: string;
  method: "GET" | "POST";
  authMode: UserDirectoryAuthMode;
  credentialPlacement: UserDirectoryCredentialPlacement;
  clientId: string;
  clientIdField: string;
  clientSecretField: string;
  tokenEndpoint: string;
  tokenCredentialPlacement: UserDirectoryTokenPlacement;
  scope: string;
  accessTokenPath: string;
  tokenTypePath: string;
  usersPath: string;
  namePath: string;
  emailPath: string;
  paginationEnabled: boolean;
  pageNumberParameter: string;
  pageSizeParameter: string;
  pageSize: number;
  countPath: string;
  pageNumberPath: string;
  pageSizePath: string;
  combineNames: boolean;
  firstNamePath: string;
  lastNamePath: string;
}

export interface UserDirectoryPerson {
  name: string;
  email: string;
}

export interface UserDirectorySettingsDto {
  config: UserDirectoryConfig;
  hasClientSecret: boolean;
}
