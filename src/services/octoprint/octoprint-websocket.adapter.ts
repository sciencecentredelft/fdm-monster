import { HttpStatusCode } from "@/constants/http-status-codes.constants";
import { AppConstants } from "@/server.constants";
import { ExternalServiceError } from "@/exceptions/runtime.exceptions";
import { httpToWsUrl } from "@/utils/url.utils";
import { normalizeUrl } from "@/utils/normalize-url";
import { OctoprintClient } from "@/services/octoprint/octoprint.client";
import EventEmitter2 from "eventemitter2";
import { LoggerService } from "@/handlers/logger";
import { ConfigService } from "@/services/core/config.service";
import type { ILoggerFactory } from "@/handlers/logger-factory";
import { AxiosError, isAxiosError } from "axios";
import type { ISocketLogin } from "@/shared/dtos/socket-login.dto";
import { WebsocketAdapter } from "@/shared/websocket.adapter";
import type { OctoPrintEventDto } from "@/services/octoprint/dto/octoprint-event.dto";
import type { LoginDto } from "@/services/interfaces/login.dto";
import { SOCKET_STATE, SocketState } from "@/shared/dtos/socket-state.type";
import { API_STATE, ApiState } from "@/shared/dtos/api-state.type";
import type { OP_LoginDto } from "@/services/octoprint/dto/auth/login.dto";
import { Event as WsEvent } from "ws";
import type { CurrentMessageDto } from "@/services/octoprint/dto/websocket/current-message.dto";
import type { OctoprintErrorDto } from "@/services/octoprint/dto/rest/error.dto";
import { OctoprintType } from "@/services/printer-api.interface";
import type { IWebsocketAdapter } from "@/services/websocket-adapter.interface";
import type { CurrentJobDto } from "@/services/octoprint/dto/job/current-job.dto";
import { OctoprintCommunicationDiagnostics } from "@/services/octoprint/octoprint-communication-diagnostics";

export const WsMessage = {
  // Custom events
  WS_OPENED: "WS_OPENED",
  WS_CLOSED: "WS_CLOSED",
  WS_ERROR: "WS_ERROR",
  API_STATE_UPDATED: "API_STATE_UPDATED",
  WS_STATE_UPDATED: "WS_STATE_UPDATED",
} as const;

export const OctoPrintMessage = {
  connected: "connected",
  reauthRequired: "reauthRequired",
  current: "current",
  history: "history",
  event: "event",
  plugin: "plugin",
  timelapse: "timelapse",
  slicingProgress: "slicingProgress",
} as const;

export const octoPrintEvent = (event: string) => `octoprint.${event}`;

export class OctoprintWebsocketAdapter extends WebsocketAdapter implements IWebsocketAdapter {
  public readonly printerType = 0;
  public printerId?: number;
  stateUpdated = false;
  stateUpdateTimestamp: null | number = null;
  socketState: SocketState = SOCKET_STATE.unopened;
  apiStateUpdated = false;
  apiStateUpdateTimestamp: null | number = null;
  apiState: ApiState = API_STATE.unset;
  lastMessageReceivedTimestamp: null | number = null;
  reauthRequired = false;
  reauthRequiredTimestamp: null | number = null;
  // Guaranteed to be set and valid by PrinterApiFactory
  login: LoginDto;
  protected logger: LoggerService;
  private socketURL?: URL;
  private sessionDto?: OP_LoginDto;
  private username?: string;
  private refreshPrinterCurrentInterval?: NodeJS.Timeout;
  private currentPollInFlight = false;
  private pollingSession = 0;
  private websocketCurrentRevision = 0;
  private readonly diagnostics?: OctoprintCommunicationDiagnostics;

  constructor(
    loggerFactory: ILoggerFactory,
    private readonly octoprintClient: OctoprintClient,
    private readonly eventEmitter2: EventEmitter2,
    private readonly configService: ConfigService,
  ) {
    super(loggerFactory);

    this.logger = loggerFactory(OctoprintWebsocketAdapter.name);
    if (this.configService.get("OCTOPRINT_COMMUNICATION_DIAGNOSTICS", "false") === "true") {
      this.diagnostics = new OctoprintCommunicationDiagnostics(this.logger, () => this.printerId);
    }
  }

  get _debugMode() {
    return this.configService.get(AppConstants.debugSocketStatesKey, AppConstants.defaultDebugSocketStates) === "true";
  }

  needsReopen() {
    const isApiOnline = this.apiState === API_STATE.responding;
    return isApiOnline && (this.socketState === SOCKET_STATE.closed || this.socketState === SOCKET_STATE.error);
  }

  needsSetup() {
    return this.socketState === SOCKET_STATE.unopened;
  }

  needsReauth() {
    return this.reauthRequired;
  }

  isClosedOrAborted() {
    return this.socketState === SOCKET_STATE.closed || this.socketState === SOCKET_STATE.aborted;
  }

  registerCredentials(socketLogin: ISocketLogin) {
    const { printerId, loginDto } = socketLogin;
    this.printerId = printerId;
    this.login = loginDto;

    const httpUrlString = normalizeUrl(this.login.printerURL);
    const httpUrl = new URL(httpUrlString);
    const httpUrlPath = httpUrl.pathname;

    const wsUrl = httpToWsUrl(httpUrlString);
    wsUrl.pathname = (httpUrlPath ?? "/") + "sockjs/websocket";
    this.socketURL = wsUrl;
  }

  open() {
    if (this.socket) {
      throw new Error(`Socket already exists by printerId, ignoring open request`);
    }

    super.open(this.socketURL);
  }

  close() {
    this.stopPolling();
    super.close();
  }

  async sendThrottle(throttle: number = AppConstants.defaultSocketThrottleRate): Promise<void> {
    return await this.sendMessage(JSON.stringify({ throttle }));
  }

  async reauthSession() {
    this.logger.log("Sending reauthSession");
    await this.setupSocketSession();
    await this.sendAuth();
    this.resetReauthRequired();
  }

  /**
   * Retrieve session token by authenticating with OctoPrint API
   */
  async setupSocketSession(): Promise<void> {
    this.resetSocketState();
    const pollingSession = this.pollingSession;
    this.sessionDto = await this.octoprintClient
      .login(this.login)
      .then((d) => {
        const r = d.data;
        // Check response for red flags
        if (r.name === "_api") {
          // TODO this conclusion is often wrong (when server is disconnected)
          this.setApiState("globalKey");
          this.setSocketState("aborted");
          throw new ExternalServiceError("Global API Key detected, aborting socket connection", "OctoPrint");
        } else if (r.needs?.group[0] === "guests") {
          this.logger.warn("Detected group guests in OctoPrint login response, marking as unauthorized");
          // This doesn't occur often (instead a 400 with CSRF failed is returned)
          this.setApiState("authFail");
          this.setSocketState("aborted");
          throw new ExternalServiceError(
            "Guest group detected, authentication failed, aborting socket connection",
            "OctoPrint",
          );
        }
        this.setApiState("responding");
        this.setSocketState("opening");
        return r;
      })
      .catch((e: AxiosError) => {
        this.setSocketState("aborted");
        // TODO improve error type detection
        if (e instanceof ExternalServiceError) {
          this.logger.warn(`Printer authorization error, apiState: ${this.apiState}`);
          throw e;
        } else {
          if (e?.response?.status === 403) {
            this.setApiState("authFail");
            this.setSocketState("aborted");
            throw new ExternalServiceError(e, "OctoPrint");
          }
          // We make an exception for such a problem concerning log anonymization
          this.logger.error(`Printer (${this.printerId}) network or transport error, marking it as unreachable; ${e}`);
          this.setApiState("noResponse");
        }
        throw e;
      });

    this.username = await this.octoprintClient.getAdminUserOrDefault(this.login).catch((e: AxiosError) => {
      const status = e.response?.status;

      this.setApiState("authFail");
      this.setSocketState("aborted");

      if (
        status &&
        [
          HttpStatusCode.BAD_GATEWAY,
          HttpStatusCode.NOT_IMPLEMENTED,
          HttpStatusCode.SERVICE_UNAVAILABLE,
          HttpStatusCode.GATEWAY_TIMEOUT,
        ].includes(status)
      ) {
        this.logger.error(`Detected a 501-504 error (${status}) probably OctoPrint has crashed or is restarting`);
      }
      throw e;
    });

    if (pollingSession !== this.pollingSession) return;
    await this.updateCurrentStateSafely();
    if (pollingSession !== this.pollingSession) return;

    this.logger.log(`Setting up printer current interval loop with 10 seconds interval`);
    this.refreshPrinterCurrentInterval = setInterval(() => {
      void this.updateCurrentStateSafely();
    }, 10000);
  }

  private stopPolling() {
    clearInterval(this.refreshPrinterCurrentInterval);
    this.refreshPrinterCurrentInterval = undefined;
    this.pollingSession++;
    this.diagnostics?.resetReports();
  }

  setReauthRequired() {
    this.reauthRequired = true;
    this.reauthRequiredTimestamp = Date.now();
  }

  resetReauthRequired() {
    this.reauthRequired = false;
    this.reauthRequiredTimestamp = null;
  }

  resetSocketState() {
    this.stopPolling();
    this.setSocketState("unopened");
    this.setApiState("unset");
  }

  emitEventSync(event: string, payload: any) {
    if (!this.eventEmittingAllowed) {
      return;
    }

    this.eventEmitter2.emit(octoPrintEvent(event), {
      event,
      payload,
      printerId: this.printerId,
      printerType: OctoprintType,
    } as OctoPrintEventDto);
  }

  protected async afterOpened(_: WsEvent): Promise<void> {
    this.setSocketState("opened");
    await this.sendAuth();
    await this.sendThrottle(AppConstants.defaultSocketThrottleRate);
  }

  protected async onMessage(message: string): Promise<void> {
    this.lastMessageReceivedTimestamp = Date.now();

    if (this.socketState !== SOCKET_STATE.authenticated) {
      this.setSocketState("authenticated");
    }

    const data = JSON.parse(message);
    const eventName = Object.keys(data)[0];
    const payload = data[eventName];

    if (eventName === OctoPrintMessage.current) {
      this.websocketCurrentRevision++;
      this.diagnostics?.observe("websocket", payload);
    }

    if (this._debugMode && !this.diagnostics) {
      this.logger.log(`Printer (${this.printerId}) WebSocket RX Msg ${eventName} ${message.substring(0, 140)}...`);
    }

    if (eventName === OctoPrintMessage.reauthRequired) {
      this.logger.log("Received 'reauthRequired', acting on it");
      this.setReauthRequired();
    }

    await this.emitEvent(eventName, payload);
  }

  protected async afterClosed(event: any) {
    this.setSocketState("closed");
    delete this.socket;
    await this.emitEvent(WsMessage.WS_CLOSED, "connection closed");
  }

  protected async onError(error: any) {
    this.setSocketState("error");
    await this.emitEvent(WsMessage.WS_ERROR, error?.length ? error : "connection error");
  }

  /**
   * Re-fetch the printer current state without depending on Websocket
   * @private
   */
  private async updateCurrentStateSafely() {
    if (this.currentPollInFlight) {
      this.diagnostics?.record("poll-skipped", "http", { reason: "poll-in-flight" });
      return;
    }
    this.currentPollInFlight = true;
    const session = this.pollingSession;
    const revision = this.websocketCurrentRevision;
    const startedAt = performance.now();
    let stage = "printer";
    const shouldDiscard = (report?: Partial<CurrentMessageDto>) => {
      const sessionChanged = session !== this.pollingSession;
      if (!sessionChanged && revision === this.websocketCurrentRevision) return false;
      this.diagnostics?.record("poll-discarded", "http", {
        stage,
        elapsedMs: Math.round(performance.now() - startedAt),
        reason: sessionChanged ? "session-changed" : "newer-websocket-current",
      });
      if (!sessionChanged && report) this.diagnostics?.observe("http", report, true);
      if (this._debugMode) {
        this.logger.log(`Printer (${this.printerId}) discarded superseded HTTP poll`);
      }
      return true;
    };

    try {
      const current = await this.octoprintClient.getPrinterCurrent(this.login, true);
      if (shouldDiscard({ state: current.data?.state })) return;
      const isOperational = current.data?.state?.flags?.operational;

      let job = {} as CurrentJobDto;
      if (isOperational) {
        stage = "job";
        const jobResponse = await this.octoprintClient.getJob(this.login);
        job = jobResponse.data;
      }

      const report = { ...current.data, progress: job?.progress, job: job?.job };
      if (shouldDiscard(report)) return;
      const requestElapsedMs = Math.round(performance.now() - startedAt);
      this.diagnostics?.observe("http", report);
      this.setApiState(API_STATE.responding);
      const requestStage = stage;
      stage = "publish";
      await this.emitEvent("current", report);
      this.diagnostics?.record("poll-success", "http", {
        stage: requestStage,
        elapsedMs: requestElapsedMs,
        socketState: this.socketState,
        websocketAgeMs:
          this.lastMessageReceivedTimestamp === null ? undefined : Date.now() - this.lastMessageReceivedTimestamp,
      });
    } catch (e) {
      const discarded = shouldDiscard();
      const error = isAxiosError(e) ? e : undefined;
      this.diagnostics?.record("poll-failed", "http", {
        stage,
        elapsedMs: Math.round(performance.now() - startedAt),
        status: error?.response?.status,
        failure: error?.response
          ? "http-response"
          : error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT"
            ? "timeout"
            : error
              ? "transport"
              : "unexpected",
        discarded,
      });
      if (discarded) return;
      if ((e as AxiosError)?.isAxiosError) {
        const castError = e as OctoprintErrorDto;
        if (castError?.response?.status == 409) {
          this.logger.error(`Printer (${this.printerId}) HTTP current poll returned 409`);
          await this.emitEvent("current", {
            state: {
              flags: {
                operational: false,
                error: false,
              },
              text: "USB disconnected",
              error: castError?.response.data.error,
            },
          } as CurrentMessageDto);
          return;
        }
        this.logger.error(`Printer (${this.printerId}) HTTP current poll failed`);
        this.setApiState(API_STATE.noResponse);
        return;
      }
      this.logger.error(`Printer (${this.printerId}) HTTP current poll failed with an unexpected error`);
      this.setApiState(API_STATE.noResponse);
    } finally {
      this.currentPollInFlight = false;
    }
  }

  private async emitEvent(event: string, payload?: any) {
    if (!this.eventEmittingAllowed) {
      return;
    }

    await this.eventEmitter2.emitAsync(octoPrintEvent(event), {
      event,
      payload,
      printerId: this.printerId,
      printerType: 0,
    } as OctoPrintEventDto);
  }

  private async sendAuth(): Promise<void> {
    if (!this.sessionDto?.session?.length) {
      throw new Error("Cant send auth, session is unset.");
    }

    this.setSocketState(SOCKET_STATE.authenticating as SocketState);
    await this.sendMessage(
      JSON.stringify({
        auth: `${this.username}:${this.sessionDto.session}`,
      }),
    );
  }

  private setSocketState(state: SocketState) {
    if (this.socketState !== state) {
      this.diagnostics?.record("socket-state", "websocket", { from: this.socketState, to: state });
    }
    this.socketState = state;
    this.stateUpdated = true;
    this.stateUpdateTimestamp = Date.now();
    if (this._debugMode) {
      this.logger.log(`${this.printerId} Socket state updated to: ` + state);
    }
    this.emitEventSync(WsMessage.WS_STATE_UPDATED, state);
  }

  private setApiState(state: ApiState) {
    if (this.apiState !== state) {
      this.diagnostics?.record("api-state", "http", { from: this.apiState, to: state });
    }
    if (state === API_STATE.globalKey) {
      this.logger.warn("Global API Key WS State detected");
    }
    this.apiState = state;
    this.apiStateUpdated = true;
    this.apiStateUpdateTimestamp = Date.now();
    if (this._debugMode) {
      this.logger.log(`${this.printerId} API state updated to: ` + state);
    }
    this.emitEventSync(WsMessage.API_STATE_UPDATED, state);
  }
}
