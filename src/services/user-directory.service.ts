import axios, { type AxiosRequestConfig } from "axios";
import { BadRequestException } from "@/exceptions/runtime.exceptions";
import { SettingsStore } from "@/state/settings.store";
import type { UserDirectoryConfig, UserDirectoryPerson } from "@/services/interfaces/user-directory.dto";

const requestTimeoutMs = 10_000;
const maxResponseBytes = 1_048_576;
const maxPages = 100;
const maxUsers = 10_000;
const cacheDurationMs = 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export class UserDirectoryService {
  private cachedUsers?: { users: UserDirectoryPerson[]; expiresAt: number };
  private pendingUsers?: Promise<UserDirectoryPerson[]>;
  private cacheRevision = 0;

  constructor(private readonly settingsStore: SettingsStore) {}

  async validateAssignment(name: string, email?: string | null): Promise<void> {
    const config = this.settingsStore.getUserDirectorySettings().config;
    if (!config.enabled || config.allowManualEntry !== false) return;
    const users = await this.listUsers();
    if (!email || !users.some((person) => person.name === name && person.email === email)) {
      throw new BadRequestException("Select a person from the user directory. Manual assignee names are disabled");
    }
  }

  invalidateCache(): void {
    this.cacheRevision++;
    this.cachedUsers = undefined;
    this.pendingUsers = undefined;
  }

  async listUsers(forceRefresh = false): Promise<UserDirectoryPerson[]> {
    const config = this.settingsStore.getUserDirectorySettings().config;
    this.validateReady(config);
    if (this.pendingUsers) return this.pendingUsers;
    if (!forceRefresh && this.cachedUsers && Date.now() < this.cachedUsers.expiresAt) {
      return this.cachedUsers.users;
    }
    this.cachedUsers = undefined;
    const revision = this.cacheRevision;
    const pending = this.fetchUsers(config).then((users) => {
      if (revision !== this.cacheRevision) {
        throw new BadRequestException("Directory settings changed during the lookup. Please retry");
      }
      this.cachedUsers = { users, expiresAt: Date.now() + cacheDurationMs };
      return users;
    });
    this.pendingUsers = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingUsers === pending) this.pendingUsers = undefined;
    }
  }

  private async fetchUsers(config: UserDirectoryConfig): Promise<UserDirectoryPerson[]> {
    const signal = AbortSignal.timeout(30_000);
    const credentials = await this.getCredentials(config, signal);
    const users: UserDirectoryPerson[] = [];
    let total: number | undefined;
    let pageSize = config.pageSize;
    for (let page = 1; page <= maxPages; page++) {
      const request = this.getUsersRequest(config, credentials);
      const endpoint = new URL(config.endpoint);
      if (config.paginationEnabled) {
        endpoint.searchParams.set(config.pageNumberParameter, String(page));
        endpoint.searchParams.set(config.pageSizeParameter, String(pageSize));
      }
      const response = await this.request(endpoint.toString(), request, signal);
      const entries = this.getPath(response.data, config.usersPath);
      if (!Array.isArray(entries)) {
        throw new BadRequestException("Directory API response did not contain a users array at the configured path");
      }
      if (config.paginationEnabled) {
        const count = this.getPath(response.data, config.countPath);
        const currentPage = this.getPath(response.data, config.pageNumberPath);
        const currentSize = this.getPath(response.data, config.pageSizePath);
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0 ||
          currentPage !== page ||
          typeof currentSize !== "number" ||
          !Number.isSafeInteger(currentSize) ||
          currentSize < 1 ||
          currentSize > pageSize ||
          (page > 1 && currentSize !== pageSize) ||
          (total !== undefined && count !== total)
        ) {
          throw new BadRequestException("Directory API returned invalid or inconsistent pagination metadata");
        }
        total = count;
        pageSize = currentSize;
        if (total > maxUsers || Math.ceil(total / pageSize) > maxPages) {
          throw new BadRequestException("Directory API exceeds the limit of 100 pages or 10000 users");
        }
        if (entries.length !== Math.min(pageSize, total - users.length)) {
          throw new BadRequestException("Directory API returned an incomplete or inconsistent page of users");
        }
      }
      users.push(...this.mapUsers(entries, config, users.length));
      if (!config.paginationEnabled || users.length === total) return users;
    }
    throw new BadRequestException("Directory API exceeds the limit of 100 pages");
  }

  private mapUsers(entries: unknown[], config: UserDirectoryConfig, offset: number): UserDirectoryPerson[] {
    return entries.map((entry, index) => {
      let name = this.getPath(entry, config.namePath);
      if (config.combineNames) {
        const parts = [this.getPath(entry, config.firstNamePath), this.getPath(entry, config.lastNamePath)];
        if (parts.some((part) => part != null && typeof part !== "string")) {
          throw new BadRequestException(`Directory API user at index ${offset + index} has an invalid name component`);
        }
        name = parts
          .filter((part): part is string => typeof part === "string")
          .map((part) => part.trim())
          .filter(Boolean)
          .join(" ");
      }
      const email = this.getPath(entry, config.emailPath);
      if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim()) {
        throw new BadRequestException(
          `Directory API user at index ${offset + index} is missing the configured name or email`,
        );
      }
      return { name: name.trim(), email: email.trim() };
    });
  }

  async testConnection(): Promise<{ success: true; userCount: number }> {
    const users = await this.listUsers(true);
    return { success: true, userCount: users.length };
  }

  private validateReady(config: UserDirectoryConfig): void {
    if (!config.enabled) {
      throw new BadRequestException("The user directory API is not enabled");
    }
    if (!config.endpoint) {
      throw new BadRequestException("The user directory endpoint is not configured");
    }
  }

  private async getCredentials(
    config: UserDirectoryConfig,
    signal: AbortSignal,
  ): Promise<{ accessToken?: string; tokenType?: string }> {
    if (config.authMode === "none") return {};

    const secret = this.settingsStore.getUserDirectoryClientSecret();
    if (!secret) throw new BadRequestException("The user directory client secret is not configured");
    if (config.authMode === "credentials") return {};

    const tokenBody = new URLSearchParams({ grant_type: "client_credentials" });
    if (config.scope) tokenBody.set("scope", config.scope);

    const tokenRequest: AxiosRequestConfig = {
      method: "POST",
      headers: { Accept: "application/json" },
    };
    if (config.tokenCredentialPlacement === "basic") {
      tokenRequest.auth = { username: config.clientId, password: secret };
      tokenRequest.data = tokenBody;
      tokenRequest.headers = { ...tokenRequest.headers, "Content-Type": "application/x-www-form-urlencoded" };
    } else if (config.tokenCredentialPlacement === "form") {
      tokenBody.set(config.clientIdField, config.clientId);
      tokenBody.set(config.clientSecretField, secret);
      tokenRequest.data = tokenBody;
      tokenRequest.headers = { ...tokenRequest.headers, "Content-Type": "application/x-www-form-urlencoded" };
    } else {
      tokenRequest.data = {
        grant_type: "client_credentials",
        ...(config.scope ? { scope: config.scope } : {}),
        [config.clientIdField]: config.clientId,
        [config.clientSecretField]: secret,
      };
    }

    const tokenResponse = await this.request(config.tokenEndpoint, tokenRequest, signal);
    const accessToken = this.getPath(tokenResponse.data, config.accessTokenPath);
    const tokenType = this.getPath(tokenResponse.data, config.tokenTypePath);
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new BadRequestException("OAuth2 response did not contain an access token at the configured path");
    }
    return {
      accessToken: accessToken.trim(),
      tokenType: typeof tokenType === "string" && tokenType.trim() ? tokenType.trim() : "Bearer",
    };
  }

  private getUsersRequest(
    config: UserDirectoryConfig,
    credentials: { accessToken?: string; tokenType?: string },
  ): AxiosRequestConfig {
    const request: AxiosRequestConfig = {
      method: config.method,
      headers: { Accept: "application/json" },
    };
    if (config.authMode === "oauth2") {
      request.headers = {
        ...request.headers,
        Authorization: `${credentials.tokenType} ${credentials.accessToken}`,
      };
      return request;
    }
    if (config.authMode !== "credentials") return request;

    const secret = this.settingsStore.getUserDirectoryClientSecret();
    if (!secret) throw new BadRequestException("The user directory client secret is not configured");
    if (config.credentialPlacement === "header") {
      request.headers = {
        ...request.headers,
        [config.clientIdField]: config.clientId,
        [config.clientSecretField]: secret,
      };
    } else if (config.credentialPlacement === "query") {
      request.params = {
        [config.clientIdField]: config.clientId,
        [config.clientSecretField]: secret,
      };
    } else if (config.credentialPlacement === "json") {
      request.data = {
        [config.clientIdField]: config.clientId,
        [config.clientSecretField]: secret,
      };
    } else {
      request.data = new URLSearchParams({
        [config.clientIdField]: config.clientId,
        [config.clientSecretField]: secret,
      });
      request.headers = { ...request.headers, "Content-Type": "application/x-www-form-urlencoded" };
    }
    return request;
  }

  private async request(url: string, requestConfig: AxiosRequestConfig, signal: AbortSignal) {
    try {
      return await axios.request({
        ...requestConfig,
        url,
        timeout: requestTimeoutMs,
        maxContentLength: maxResponseBytes,
        maxBodyLength: 65_536,
        maxRedirects: 0,
        responseType: "json",
        signal,
      });
    } catch (error) {
      if (!axios.isAxiosError(error)) throw error;
      const status = error.response?.status;
      throw new BadRequestException(
        signal.aborted
          ? "Directory API lookup exceeded the 30-second time limit"
          : status
            ? `Directory API request failed with HTTP ${status}`
            : "Could not reach the directory API",
      );
    }
  }

  private getPath(value: unknown, path: string): unknown {
    const normalizedPath = path.replace(/^\$\.?/, "");
    const segments = normalizedPath.match(/[A-Za-z0-9_-]+|\[\d+\]/g) ?? [];
    return segments.reduce<unknown>((current, segment) => {
      if (segment.startsWith("[")) {
        if (!Array.isArray(current)) return undefined;
        return current[Number(segment.slice(1, -1))];
      }
      if (!current || typeof current !== "object") return undefined;
      return (current as JsonRecord)[segment];
    }, value);
  }
}
