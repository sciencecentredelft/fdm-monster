import { AwilixContainer } from "awilix";
import { Test } from "supertest";
import { setupTestApp } from "../../test-server";
import { expectOkResponse } from "../../extensions";
import { DITokens } from "@/container.tokens";
import { AppConstants } from "@/server.constants";
import { ServerHost } from "@/server.host";
import TestAgent from "supertest/lib/agent";
import { LoggerService } from "@/handlers/logger";
import { vi } from "vitest";

let container: AwilixContainer;
let serverHost: ServerHost;
let request: TestAgent<Test>;

beforeAll(async () => {
  ({ container, request } = await setupTestApp(true, undefined, false));
  serverHost = container.resolve(DITokens.serverHost);
});

describe(ServerHost.name, () => {
  it("logs failed API caller IPs without query parameters, bodies, or forwarded-header spoofing", async () => {
    const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
    try {
      const response = await request
        .post("/api/v1/printer?apiKey=private-query")
        .set("X-Forwarded-For", "203.0.113.123")
        .set("Authorization", "Bearer private-token")
        .send({ secret: "private-body" });
      expect(response.status).toBeGreaterThanOrEqual(400);
      const calls = warn.mock.calls.filter(([message]) => message === "API request failed");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual({
        meta: {
          method: "POST",
          path: "/api/v1/printer",
          statusCode: response.status,
          clientIp: expect.stringMatching(/^(::ffff:)?127\.0\.0\.1$|^::1$/),
        },
      });
      const logs = JSON.stringify(calls);
      for (const sensitive of ["private-query", "private-token", "private-body", "203.0.113.123"]) {
        expect(logs).not.toContain(sensitive);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn for successful API requests or non-API responses", async () => {
    const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
    try {
      expectOkResponse(await request.get(AppConstants.apiRoute).send());
      await request.get("/missing-static-file.js").send();
      expect(warn.mock.calls.filter(([message]) => message === "API request failed")).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("should be connected to database", () => {
    expect(serverHost.hasConnected()).toBeTruthy();
  });

  it("should redirect to API docs - skipping history redirect - for /api", async () => {
    const response = await request.get(AppConstants.apiRoute).send();
    expectOkResponse(response);
  });

  /**
   * The /test endpoint does not exist on the backend, so it's rewritten to /index.html
   */
  it("should hit history redirect for /test", async () => {
    const response = await request.get("/test").set("Accept", "text/html").send();
    expectOkResponse(response);
  });

  it("should hit static file for /index.html", async () => {
    const response = await request.get("/index.html").send();
    expectOkResponse(response);
  });
});
