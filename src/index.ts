import { captureException, flush } from "@sentry/node";
import { setupEnvConfig } from "./server.env";
import { setupServer } from "./server.core";
import { DITokens } from "./container.tokens";
import { ServerHost } from "@/server.host";
import { LoggerService as Logger } from "@/handlers/logger";
import { createStaticLogger } from "@/handlers/logging/static.logger";
import { enableCpuProfileCapture } from "@/handlers/cpu-profile";
import { enableSqliteQueryDiagnostics } from "@/handlers/sqlite-query-diagnostics";

createStaticLogger({ enableFileLogs: true });
const logger = new Logger("FDM-Environment");
logger.log("✓ Parsed environment with (optional) .env file, created static logger");

setupEnvConfig();
enableCpuProfileCapture(logger);
enableSqliteQueryDiagnostics(logger);

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

setupServer().then(({ httpServer, container }) => {
  container
    .resolve<ServerHost>(DITokens.serverHost)
    .boot(httpServer)
    .catch(async (e: Error) => {
      console.error("Server has crashed unintentionally - please report this", e);

      captureException(e);
      await flush(0);
      process.exit(1);
    });
});
