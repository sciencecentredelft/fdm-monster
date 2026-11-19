import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { AfterQueryEvent, EntitySubscriberInterface } from "typeorm";
import type { LoggerService } from "@/handlers/logger";

type OctoPrintOperation = "start" | "thumbnail" | "analysis" | "metadata" | "progress" | "finish" | "fail";
type QueryStats = {
  fingerprint: string;
  operation: string;
  source: string;
  calls: number;
  totalMs: number;
  maxMs: number;
};
type Capture = {
  deadline: number;
  queries: Map<string, QueryStats>;
  omittedCalls: number;
  octoPrintCurrentEvents: number;
};

const durationMs = 20_000;
const context = new AsyncLocalStorage<OctoPrintOperation>();
let capture: Capture | undefined;

function activeCapture() {
  return capture && performance.now() < capture.deadline ? capture : undefined;
}

export function countOctoPrintCurrent() {
  const active = activeCapture();
  if (active) active.octoPrintCurrentEvents++;
}

export function withOctoPrintQueryContext<T>(operation: OctoPrintOperation, work: () => T): T {
  return activeCapture() ? context.run(operation, work) : work();
}

export class SqliteQueryDiagnostics implements EntitySubscriberInterface {
  afterQuery({ query, executionTime, success }: AfterQueryEvent<unknown>) {
    const active = activeCapture();
    if (!active || !success || executionTime === undefined) return;

    const shape = query
      .replace(/'(?:''|[^'])*'/g, "?")
      .replace(/\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, "?")
      .replace(/\s+/g, " ")
      .trim();
    const fingerprint = createHash("sha256").update(shape).digest("hex").slice(0, 16);
    const operationContext = context.getStore();
    const source = operationContext ? `octoprint.${operationContext}` : "unattributed";
    const key = `${source}:${fingerprint}`;
    let stats = active.queries.get(key);
    if (!stats) {
      if (active.queries.size >= 512) {
        active.omittedCalls++;
        return;
      }
      const operation = /^(SELECT|INSERT|UPDATE|DELETE|WITH|PRAGMA)\b/i.exec(shape)?.[1].toUpperCase() ?? "OTHER";
      stats = { fingerprint, operation, source, calls: 0, totalMs: 0, maxMs: 0 };
      active.queries.set(key, stats);
    }
    stats.calls++;
    stats.totalMs += executionTime;
    stats.maxMs = Math.max(stats.maxMs, executionTime);
  }
}

export function startSqliteQueryCapture(logger: LoggerService) {
  const window: Capture = {
    deadline: performance.now() + durationMs,
    queries: new Map(),
    omittedCalls: 0,
    octoPrintCurrentEvents: 0,
  };
  capture = window;
  logger.warn("SQLite query diagnostics started (20 seconds)");
  setTimeout(() => {
    capture = undefined;
    const ranked = [...window.queries.values()].sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls);
    logger.warn("SQLite query diagnostics summary", {
      meta: {
        windowMs: durationMs,
        octoPrintCurrentEvents: window.octoPrintCurrentEvents,
        queries: ranked.reduce((sum, stats) => sum + stats.calls, 0) + window.omittedCalls,
        timedMs: ranked.reduce((sum, stats) => sum + stats.totalMs, 0),
        queryGroups: ranked.length,
        omittedCalls: window.omittedCalls,
      },
    });
    for (const stats of ranked.slice(0, 20)) {
      logger.warn("SQLite query diagnostics group", { meta: stats });
    }
  }, durationMs).unref();
}

export function enableSqliteQueryDiagnostics(logger: LoggerService) {
  if (process.env.FDM_SQLITE_QUERY_DIAGNOSTICS !== "true") return;
  if (process.platform !== "linux") {
    logger.warn("FDM_SQLITE_QUERY_DIAGNOSTICS is supported only on Linux");
    return;
  }

  let triggered = false;
  process.on("SIGUSR2", () => {
    if (triggered) return;
    triggered = true;
    startSqliteQueryCapture(logger);
  });
  logger.warn("SQLite query diagnostics armed: send SIGUSR2 to capture once");
}
