import nock from "nock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultUserDirectoryConfig } from "@/constants/server-settings.constants";
import type { UserDirectoryConfig } from "@/services/interfaces/user-directory.dto";
import { UserDirectoryService } from "@/services/user-directory.service";
import type { SettingsStore } from "@/state/settings.store";
import { userDirectoryConfigSchema } from "@/services/validators/settings-service.validation";

const clientSecret = "test-client-secret";

function createService(config: Partial<UserDirectoryConfig>, secret = clientSecret) {
  const resolvedConfig = { ...getDefaultUserDirectoryConfig(), ...config };
  const store = {
    getUserDirectorySettings: () => ({ config: resolvedConfig, hasClientSecret: !!secret }),
    getUserDirectoryClientSecret: () => secret,
  } as unknown as SettingsStore;
  return new UserDirectoryService(store);
}

afterEach(() => {
  nock.cleanAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe(UserDirectoryService.name, () => {
  const cacheConfig = { enabled: true, endpoint: "https://directory.example/users" };
  const cachedPerson = { name: "Ada", email: "ada@example.com" };

  it("shares concurrent lookups and caches users until exactly 24 hours after completion", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const api = nock("https://directory.example")
      .get("/users")
      .delay(10)
      .reply(200, { users: [cachedPerson] });
    const service = createService(cacheConfig);
    const first = await Promise.all([service.listUsers(), service.listUsers(), service.listUsers(true)]);
    expect(first).toEqual([[cachedPerson], [cachedPerson], [cachedPerson]]);
    expect(api.isDone()).toBe(true);
    now += 24 * 60 * 60 * 1000 - 1;
    await expect(service.listUsers()).resolves.toEqual([cachedPerson]);
    now++;
    const refreshed = nock("https://directory.example").get("/users").reply(200, { users: [] });
    await expect(service.listUsers()).resolves.toEqual([]);
    await expect(service.listUsers()).resolves.toEqual([]);
    expect(refreshed.isDone()).toBe(true);
  });

  it("forces an immediate refresh and keeps connection tests live", async () => {
    const service = createService(cacheConfig);
    nock("https://directory.example")
      .get("/users")
      .reply(200, { users: [cachedPerson] });
    await service.listUsers();
    nock("https://directory.example").get("/users").reply(200, { users: [] });
    await expect(service.listUsers(true)).resolves.toEqual([]);
    nock("https://directory.example")
      .get("/users")
      .reply(200, { users: [cachedPerson] });
    await expect(service.testConnection()).resolves.toEqual({ success: true, userCount: 1 });
    await expect(service.listUsers()).resolves.toEqual([cachedPerson]);
  });

  it("does not cache failed refreshes or fall back silently to the old list", async () => {
    const service = createService(cacheConfig);
    nock("https://directory.example")
      .get("/users")
      .reply(200, { users: [cachedPerson] });
    await service.listUsers();
    nock("https://directory.example").get("/users").reply(500);
    await expect(service.listUsers(true)).rejects.toThrow("HTTP 500");
    nock("https://directory.example").get("/users").reply(503);
    await expect(service.listUsers()).rejects.toThrow("HTTP 503");
    nock("https://directory.example").get("/users").reply(200, { users: [] });
    await expect(service.listUsers()).resolves.toEqual([]);
  });

  it("invalidates cached and in-flight results when directory settings change", async () => {
    const service = createService(cacheConfig);
    nock("https://directory.example")
      .get("/users")
      .reply(200, { users: [cachedPerson] });
    await service.listUsers();
    service.invalidateCache();
    nock("https://directory.example")
      .get("/users")
      .delay(30)
      .reply(200, { users: [cachedPerson] });
    const previous = expect(service.listUsers()).rejects.toThrow("settings changed");
    service.invalidateCache();
    nock("https://directory.example").get("/users").reply(200, { users: [] });
    await expect(service.listUsers()).resolves.toEqual([]);
    await previous;
    await expect(service.listUsers()).resolves.toEqual([]);
  });

  const paginatedConfig: Partial<UserDirectoryConfig> = {
    enabled: true,
    endpoint: "https://directory.example/users",
    paginationEnabled: true,
    usersPath: "results",
    combineNames: true,
    pageSize: 2,
  };
  const person = (name: string) => ({ first_name: ` ${name} `, last_name: " Example ", email: `${name}@example.com` });

  it("fetches every numbered page, combines names and reuses a single OAuth token", async () => {
    const token = nock("https://auth.example")
      .post("/token", { grant_type: "client_credentials", client_id: "client-123", client_secret: clientSecret })
      .reply(200, { access_token: "access-token" });
    const pages = nock("https://directory.example")
      .get("/users")
      .query({ page_number: 1, page_size: 2 })
      .matchHeader("authorization", "Bearer access-token")
      .reply(200, { count: 3, page_number: 1, page_size: 2, results: [person("Ada"), person("Grace")] })
      .get("/users")
      .query({ page_number: 2, page_size: 2 })
      .matchHeader("authorization", "Bearer access-token")
      .reply(200, { count: 3, page_number: 2, page_size: 2, results: [person("Linus")] });
    await expect(
      createService({
        ...paginatedConfig,
        authMode: "oauth2",
        clientId: "client-123",
        tokenEndpoint: "https://auth.example/token",
      }).listUsers(),
    ).resolves.toEqual([
      { name: "Ada Example", email: "Ada@example.com" },
      { name: "Grace Example", email: "Grace@example.com" },
      { name: "Linus Example", email: "Linus@example.com" },
    ]);
    expect(token.isDone()).toBe(true);
    expect(pages.isDone()).toBe(true);
  });

  it("loads all 1829 users over 37 pages at the requested page size", async () => {
    const api = nock("https://directory.example");
    for (let page = 1; page <= 37; page++) {
      api
        .get("/users")
        .query({ page_number: page, page_size: 50 })
        .reply(200, {
          count: 1829,
          page_number: page,
          page_size: 50,
          results: Array.from({ length: page === 37 ? 29 : 50 }, (_, index) => person(`Person-${page}-${index}`)),
        });
    }
    const users = await createService({ ...paginatedConfig, pageSize: 50 }).listUsers();
    expect(users).toHaveLength(1829);
    expect(users.at(-1)?.name).toBe("Person-37-28 Example");
    expect(api.isDone()).toBe(true);
  });

  it("supports custom paths, parameters, existing URL filters and query credentials", async () => {
    nock("https://directory.example")
      .get("/users")
      .query({ team: "printers", page: 1, limit: 2, client_id: "client-123", client_secret: clientSecret })
      .reply(200, { data: { total: 1, page: 1, size: 2, people: [person("Ada")] } });
    await expect(
      createService({
        ...paginatedConfig,
        endpoint: "https://directory.example/users?team=printers&page=99&limit=99",
        authMode: "credentials",
        credentialPlacement: "query",
        clientId: "client-123",
        pageNumberParameter: "page",
        pageSizeParameter: "limit",
        countPath: "data.total",
        pageNumberPath: "data.page",
        pageSizePath: "data.size",
        usersPath: "data.people",
      }).testConnection(),
    ).resolves.toEqual({ success: true, userCount: 1 });
  });

  it("accepts an empty directory", async () => {
    nock("https://directory.example")
      .get("/users")
      .query(true)
      .reply(200, { count: 0, page_number: 1, page_size: 2, results: [] });
    await expect(createService(paginatedConfig).listUsers()).resolves.toEqual([]);
  });

  it("honours a smaller server page-size cap", async () => {
    nock("https://directory.example")
      .get("/users")
      .query({ page_number: 1, page_size: 2 })
      .reply(200, { count: 2, page_number: 1, page_size: 1, results: [person("Ada")] })
      .get("/users")
      .query({ page_number: 2, page_size: 1 })
      .reply(200, { count: 2, page_number: 2, page_size: 1, results: [person("Grace")] });
    await expect(createService(paginatedConfig).listUsers()).resolves.toHaveLength(2);
  });

  it.each([
    { count: -1, page_number: 1, page_size: 2, results: [] },
    { count: "2", page_number: 1, page_size: 2, results: [] },
    { count: 2, page_number: 2, page_size: 2, results: [person("Ada"), person("Grace")] },
    { count: 2, page_number: 1, page_size: 0, results: [] },
    { count: 2, page_number: 1, page_size: 2, results: [person("Ada")] },
    { count: 2, page_number: 1, results: [] },
    { count: 201, page_number: 1, page_size: 2, results: [] },
    { count: 10001, page_number: 1, page_size: 2, results: [] },
  ])("rejects malformed, incomplete or excessive pagination: %j", async (response) => {
    nock("https://directory.example").get("/users").query(true).reply(200, response);
    await expect(createService(paginatedConfig).listUsers()).rejects.toThrow("Directory API");
  });

  it.each(["changed-count", "repeated-page", "failed-page"])(
    "rejects %s without returning partial results",
    async (failure) => {
      const api = nock("https://directory.example")
        .get("/users")
        .query({ page_number: 1, page_size: 2 })
        .reply(200, { count: 3, page_number: 1, page_size: 2, results: [person("Ada"), person("Grace")] })
        .get("/users")
        .query({ page_number: 2, page_size: 2 });
      api.reply(failure === "failed-page" ? 500 : 200, {
        count: failure === "changed-count" ? 4 : 3,
        page_number: failure === "repeated-page" ? 1 : 2,
        page_size: 2,
        results: [person("Linus")],
      });
      await expect(createService(paginatedConfig).listUsers()).rejects.toThrow("Directory API");
    },
  );

  it("combines available name parts but rejects invalid or empty names", async () => {
    nock("https://directory.example")
      .get("/users")
      .reply(200, {
        users: [
          { first_name: " Ada ", last_name: null, email: "ada@example.com" },
          { last_name: " Example ", email: "example@example.com" },
        ],
      });
    await expect(
      createService({
        enabled: true,
        endpoint: "https://directory.example/users",
        combineNames: true,
      }).listUsers(),
    ).resolves.toEqual([
      { name: "Ada", email: "ada@example.com" },
      { name: "Example", email: "example@example.com" },
    ]);
    for (const first_name of [42, "", null]) {
      nock("https://directory.example")
        .get("/users")
        .reply(200, { users: [{ first_name, email: "ada@example.com" }] });
      await expect(
        createService({
          enabled: true,
          endpoint: "https://directory.example/users",
          combineNames: true,
        }).listUsers(),
      ).rejects.toThrow("Directory API user at index 0");
    }
  });

  it("defaults older configurations to non-paginated single-name mapping", () => {
    const legacy = getDefaultUserDirectoryConfig();
    for (const key of [
      "paginationEnabled",
      "allowManualEntry",
      "pageNumberParameter",
      "pageSizeParameter",
      "pageSize",
      "countPath",
      "pageNumberPath",
      "pageSizePath",
      "combineNames",
      "firstNamePath",
      "lastNamePath",
    ]) {
      Reflect.deleteProperty(legacy, key);
    }
    expect(userDirectoryConfigSchema.parse(legacy)).toEqual(getDefaultUserDirectoryConfig());
  });

  it.each([
    { method: "POST" },
    { pageSize: 0 },
    { pageSize: 1001 },
    { pageSize: 1.5 },
    { pageNumberParameter: "page_size" },
    { countPath: "invalid path" },
    { authMode: "credentials", credentialPlacement: "query", clientIdField: "page_number" },
  ])("rejects invalid pagination configuration: %j", (overrides) => {
    expect(
      userDirectoryConfigSchema.safeParse({
        ...getDefaultUserDirectoryConfig(),
        ...paginatedConfig,
        clientId: "client-123",
        ...overrides,
      }).success,
    ).toBe(false);
  });

  it("uses configured direct credential headers and maps nested response paths", async () => {
    nock("https://directory.example")
      .get("/users")
      .matchHeader("x-client-id", "client-123")
      .matchHeader("x-client-secret", clientSecret)
      .reply(200, {
        result: {
          people: [{ profile: { display_name: " Ada Lovelace " }, contact: { email_address: "ada@example.com" } }],
        },
      });

    const service = createService({
      enabled: true,
      endpoint: "https://directory.example/users",
      authMode: "credentials",
      credentialPlacement: "header",
      clientId: "client-123",
      clientIdField: "x-client-id",
      clientSecretField: "x-client-secret",
      usersPath: "$.result.people",
      namePath: "$.profile.display_name",
      emailPath: "contact.email_address",
    });

    await expect(service.listUsers()).resolves.toEqual([{ name: "Ada Lovelace", email: "ada@example.com" }]);
  });

  it("supports query-parameter credentials", async () => {
    nock("https://directory.example")
      .get("/users")
      .query({ key: "client-123", secret: clientSecret })
      .reply(200, { users: [{ name: "Ada", email: "ada@example.com" }] });

    const service = createService({
      enabled: true,
      endpoint: "https://directory.example/users",
      authMode: "credentials",
      credentialPlacement: "query",
      clientId: "client-123",
      clientIdField: "key",
      clientSecretField: "secret",
    });

    await expect(service.listUsers()).resolves.toEqual([{ name: "Ada", email: "ada@example.com" }]);
  });

  it("supports JSON and form request-body credentials", async () => {
    nock("https://directory.example")
      .post("/json-users", { id: "client-123", secret: clientSecret })
      .reply(200, { users: [{ name: "Ada", email: "ada@example.com" }] });
    nock("https://directory.example")
      .post("/form-users", (body) => {
        const values = typeof body === "string" ? Object.fromEntries(new URLSearchParams(body)) : body;
        return values.id === "client-123" && values.secret === clientSecret;
      })
      .matchHeader("content-type", "application/x-www-form-urlencoded")
      .reply(200, { users: [{ name: "Grace", email: "grace@example.com" }] });

    const jsonService = createService({
      enabled: true,
      endpoint: "https://directory.example/json-users",
      method: "POST",
      authMode: "credentials",
      credentialPlacement: "json",
      clientId: "client-123",
      clientIdField: "id",
      clientSecretField: "secret",
    });
    const formService = createService({
      enabled: true,
      endpoint: "https://directory.example/form-users",
      method: "POST",
      authMode: "credentials",
      credentialPlacement: "form",
      clientId: "client-123",
      clientIdField: "id",
      clientSecretField: "secret",
    });

    await expect(jsonService.listUsers()).resolves.toEqual([{ name: "Ada", email: "ada@example.com" }]);
    await expect(formService.listUsers()).resolves.toEqual([{ name: "Grace", email: "grace@example.com" }]);
  });

  it("exchanges OAuth2 client credentials and uses the configured token paths", async () => {
    nock("https://auth.example")
      .post("/token", {
        grant_type: "client_credentials",
        scope: "printer-users",
        application_id: "client-123",
        application_secret: clientSecret,
      })
      .reply(200, { payload: { token: "access-token", scheme: "Token" } });
    nock("https://directory.example")
      .get("/users")
      .matchHeader("authorization", "Token access-token")
      .reply(200, { data: { users: [{ name: "Grace", email: "grace@example.com" }] } });

    const service = createService({
      enabled: true,
      endpoint: "https://directory.example/users",
      authMode: "oauth2",
      clientId: "client-123",
      clientIdField: "application_id",
      clientSecretField: "application_secret",
      tokenEndpoint: "https://auth.example/token",
      tokenCredentialPlacement: "json",
      scope: "printer-users",
      accessTokenPath: "payload.token",
      tokenTypePath: "payload.scheme",
      usersPath: "data.users",
    });

    await expect(service.testConnection()).resolves.toEqual({ success: true, userCount: 1 });
  });

  it("rejects malformed mapped user rows instead of returning incomplete identities", async () => {
    nock("https://directory.example")
      .get("/users")
      .reply(200, { users: [{ name: "Ada" }] });
    const service = createService({
      enabled: true,
      endpoint: "https://directory.example/users",
      usersPath: "users",
    });

    await expect(service.listUsers()).rejects.toThrow("missing the configured name or email");
  });
});
