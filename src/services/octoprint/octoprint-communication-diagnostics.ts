import { createHash } from "node:crypto";
import type { LoggerService } from "@/handlers/logger";
import type { CurrentMessageDto } from "./dto/websocket/current-message.dto";

type Source = "websocket" | "http";
type DiagnosticEvent =
  | "socket-state"
  | "api-state"
  | "poll-success"
  | "poll-failed"
  | "poll-discarded"
  | "poll-skipped"
  | "websocket-current"
  | "report-changed"
  | "report-conflict";

const sampleIntervalMs = 60_000;
const comparisonWindowMs = 30_000;

export class OctoprintCommunicationDiagnostics {
  private readonly samples = new Map<DiagnosticEvent, { loggedAt: number; suppressed: number }>();
  private reports: Partial<Record<Source, ReturnType<typeof summarize>>> = {};

  constructor(
    private readonly logger: LoggerService,
    private readonly printerId: () => number | undefined,
  ) {}

  resetReports() {
    this.reports = {};
  }

  record(event: DiagnosticEvent, source: Source, details: object) {
    const now = Date.now();
    const sample = this.samples.get(event);
    const interval = event === "socket-state" || event === "api-state" ? 5_000 : sampleIntervalMs;
    if (sample && now - sample.loggedAt < interval) {
      sample.suppressed++;
      return;
    }
    this.samples.set(event, { loggedAt: now, suppressed: 0 });
    this.logger.warn(`OctoPrint diagnostics: ${event}`, {
      meta: { printerId: this.printerId(), source, ...details, suppressed: sample?.suppressed ?? 0 },
    });
  }

  observe(source: Source, payload: Partial<CurrentMessageDto>, discarded = false) {
    const report = summarize(payload);
    const previous = this.reports[source];
    if (!discarded) this.reports[source] = report;
    const { observedAt, ...summary } = report;
    if (source === "websocket") this.record("websocket-current", source, summary);

    const compare = (other: typeof previous, otherSource: Source, event: "report-changed" | "report-conflict") => {
      if (!other || observedAt - other.observedAt > comparisonWindowMs) return;
      const stateDiffers = Object.entries(summary.flags).some(([key, value]) => {
        const previousValue = other.flags[key];
        return previousValue !== undefined && previousValue !== value;
      });
      const jobDiffers = summary.job !== undefined && other.job !== undefined && summary.job !== other.job;
      if (!stateDiffers && !jobDiffers) return;
      const { observedAt: otherObservedAt, ...otherSummary } = other;
      this.record(event, source, {
        stateDiffers,
        jobDiffers,
        discarded,
        otherSource,
        otherReportAgeMs: observedAt - otherObservedAt,
        report: summary,
        otherReport: otherSummary,
      });
    };
    if (!discarded) compare(previous, source, "report-changed");
    const otherSource = source === "http" ? "websocket" : "http";
    compare(this.reports[otherSource], otherSource, "report-conflict");
  }
}

function summarize(payload: Partial<CurrentMessageDto>) {
  const flags: Record<string, boolean> = {};
  for (const key of [
    "operational",
    "printing",
    "paused",
    "finishing",
    "cancelling",
    "error",
    "closedOrError",
  ] as const) {
    const value = payload?.state?.flags?.[key];
    if (typeof value === "boolean") flags[key] = value;
  }
  const path = payload?.job?.file?.path;
  const elapsedSeconds = payload?.progress?.printTime;
  return {
    observedAt: Date.now(),
    flags,
    job: typeof path === "string" && path ? createHash("sha256").update(path).digest("hex").slice(0, 12) : undefined,
    elapsedSeconds: typeof elapsedSeconds === "number" && Number.isFinite(elapsedSeconds) ? elapsedSeconds : undefined,
  };
}
