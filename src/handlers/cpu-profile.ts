import { mkdtemp, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { LoggerService } from "@/handlers/logger";
import { errorSummary } from "@/utils/error.utils";

export function enableCpuProfileCapture(logger: LoggerService) {
  if (process.env.FDM_CPU_PROFILE !== "true") return;
  if (process.platform !== "linux") {
    logger.warn("FDM_CPU_PROFILE is supported only on Linux");
    return;
  }

  let triggered = false;
  process.on("SIGUSR2", () => {
    if (triggered) return;
    triggered = true;
    void captureCpuProfile(logger).catch((error: unknown) => {
      logger.error(`CPU profile capture failed: ${errorSummary(error)}`);
    });
  });
  logger.warn("CPU profile armed: send SIGUSR2 to capture once");
}

async function captureCpuProfile(logger: LoggerService) {
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.start");
    logger.warn("CPU profile capture started (20 seconds)");
    await setTimeout(20_000);
    const { profile } = await session.post("Profiler.stop");
    const directory = await mkdtemp(join(tmpdir(), "fdm-cpu-profile-"));
    const path = join(directory, "fdm-monster.cpuprofile");
    await writeFile(path, JSON.stringify(profile), { mode: 0o600, flag: "wx" });
    logger.warn(`CPU profile saved: ${path}`);
  } finally {
    session.disconnect();
  }
}
