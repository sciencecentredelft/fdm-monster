import EventEmitter2 from "eventemitter2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoggerFactory } from "@/handlers/logger-factory";
import { LoggerService } from "@/handlers/logger";
import type { ConfigService } from "@/services/core/config.service";
import type { OctoprintClient } from "@/services/octoprint/octoprint.client";
import { octoPrintEvent, OctoprintWebsocketAdapter } from "@/services/octoprint/octoprint-websocket.adapter";

class TestAdapter extends OctoprintWebsocketAdapter {
  receiveCurrent(file: string) {
    return this.onMessage(JSON.stringify({ current: { job: { file: { path: file } } } }));
  }
}

function setupAdapter(diagnosticsEnabled = false) {
  const printerState = { data: { state: { flags: { operational: true } } } };
  const client = {
    login: vi.fn().mockResolvedValue({ data: { name: "test" } }),
    getAdminUserOrDefault: vi.fn().mockResolvedValue("test"),
    getPrinterCurrent: vi.fn<() => Promise<typeof printerState>>().mockResolvedValue(printerState),
    getJob: vi.fn<() => Promise<{ data: { job: { file: { path: string } } } }>>().mockResolvedValue({
      data: { job: { file: { path: "polled.gcode" } } },
    }),
  };
  const events = new EventEmitter2();
  const current = vi.fn();
  events.on(octoPrintEvent("current"), current);
  const adapter = new TestAdapter(LoggerFactory(), client as unknown as OctoprintClient, events, {
    get: (key: string) => String(key === "OCTOPRINT_COMMUNICATION_DIAGNOSTICS" && diagnosticsEnabled),
  } as ConfigService);
  adapter.registerCredentials({ printerId: 15, loginDto: { printerURL: "http://localhost", printerType: 0 } });
  return { adapter, client, current, printerState };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe(OctoprintWebsocketAdapter.name, () => {
  it("skips interval ticks while a poll is in flight, then resumes polling", async () => {
    vi.useFakeTimers();
    const { adapter, client, current, printerState } = setupAdapter();
    await adapter.setupSocketSession();
    const delayed = Promise.withResolvers<typeof printerState>();
    client.getPrinterCurrent.mockReturnValueOnce(delayed.promise);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.getPrinterCurrent).toHaveBeenCalledTimes(2);
    expect(current).toHaveBeenCalledTimes(1);
    delayed.resolve(printerState);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.getPrinterCurrent).toHaveBeenCalledTimes(3);
    expect(current).toHaveBeenCalledTimes(3);
    adapter.close();
  });

  it("does not publish a delayed HTTP job over a newer WebSocket update", async () => {
    vi.useFakeTimers();
    const { adapter, client, current } = setupAdapter();
    await adapter.setupSocketSession();
    current.mockClear();
    const delayed = Promise.withResolvers<Awaited<ReturnType<typeof client.getJob>>>();
    client.getJob.mockReturnValueOnce(delayed.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.getJob).toHaveBeenCalledTimes(2);

    await adapter.receiveCurrent("live.gcode");
    delayed.resolve({ data: { job: { file: { path: "stale.gcode" } } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(current).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ payload: { job: { file: { path: "live.gcode" } } } }),
    );
    adapter.close();
  });

  it("ignores an initial poll that resolves after the adapter closes and does not restart polling", async () => {
    vi.useFakeTimers();
    const { adapter, client, current, printerState } = setupAdapter();
    const delayed = Promise.withResolvers<typeof printerState>();
    client.getPrinterCurrent.mockReturnValueOnce(delayed.promise);
    const setup = adapter.setupSocketSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getPrinterCurrent).toHaveBeenCalledTimes(1);
    adapter.close();
    delayed.resolve(printerState);
    await setup;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.getPrinterCurrent).toHaveBeenCalledTimes(1);
    expect(client.getJob).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
  });

  it("keeps communication diagnostics off by default", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(LoggerService.prototype, "warn");
    const { adapter } = setupAdapter();
    await adapter.setupSocketSession();
    await adapter.receiveCurrent("other.gcode");
    expect(warn.mock.calls.some(([message]) => message.startsWith("OctoPrint diagnostics:"))).toBe(false);
    adapter.close();
  });

  it("identifies conflicting report sources and discarded HTTP jobs without logging their paths", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
    const { adapter, client } = setupAdapter(true);
    await adapter.setupSocketSession();
    const delayed = Promise.withResolvers<Awaited<ReturnType<typeof client.getJob>>>();
    client.getJob.mockReturnValueOnce(delayed.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    await adapter.receiveCurrent("polled.gcode");
    delayed.resolve({ data: { job: { file: { path: "private/stale.gcode" } } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("OctoPrint diagnostics: poll-discarded", {
      meta: expect.objectContaining({ printerId: 15, source: "http", reason: "newer-websocket-current", stage: "job" }),
    });
    expect(warn).toHaveBeenCalledWith("OctoPrint diagnostics: report-conflict", {
      meta: expect.objectContaining({ source: "http", otherSource: "websocket", jobDiffers: true, discarded: true }),
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/polled\.gcode|private\/stale\.gcode/);
    adapter.close();
  });

  it("samples repeated poll outcomes and includes the suppressed count in the next sample", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
    const polls = () => warn.mock.calls.filter(([message]) => message === "OctoPrint diagnostics: poll-success");
    const { adapter } = setupAdapter(true);
    await adapter.setupSocketSession();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(polls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls()).toHaveLength(2);
    expect(polls()[1]?.[1]).toEqual({
      meta: expect.objectContaining({ printerId: 15, source: "http", elapsedMs: expect.any(Number), suppressed: 5 }),
    });
    adapter.close();
  });

  it("reports failed HTTP stages and statuses without logging upstream error details", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(LoggerService.prototype, "warn").mockImplementation(() => {});
    const { adapter, client } = setupAdapter(true);
    client.getJob.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503, data: "private-response" },
      config: { headers: { Authorization: "private-credential" } },
    });
    await adapter.setupSocketSession();
    expect(warn).toHaveBeenCalledWith("OctoPrint diagnostics: poll-failed", {
      meta: expect.objectContaining({
        printerId: 15,
        source: "http",
        stage: "job",
        status: 503,
        failure: "http-response",
        discarded: false,
      }),
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private-response|private-credential/);
    adapter.close();
  });
});
