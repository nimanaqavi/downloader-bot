import { gramjsMonitor } from "./gramjsMonitor.js";
import { triggerGC } from "../utils/gc.js";

export interface UploadResponse {
  messageId: number;
  chatId: number | string;
}

export interface AudioMetadata {
  title?: string;
  performer?: string;
  duration?: number;
}

export interface VideoMetadata {
  duration?: number;
  width?: number;
  height?: number;
}

export class MtprotoUploader {
  private client: any = null;
  private connectingPromise: Promise<any> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_DISCONNECT_MS = 60_000; // 60 seconds

  constructor(
    private readonly apiId: number = 2040,
    private readonly apiHash: string = "b18441a1ff607e10a989891a5462e627",
    private readonly botToken: string
  ) {}

  private async getClient(): Promise<any> {
    if (this.client && this.client.connected) {
      return this.client;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      try {
        const { TelegramClient } = await import("telegram");
        const { StringSession } = await import("telegram/sessions/index.js");

        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, this.apiId || 2040, this.apiHash || "b18441a1ff607e10a989891a5462e627", {
          connectionRetries: 5,
          useWSS: false,
          autoReconnect: true
        });

        await client.start({
          botAuthToken: this.botToken
        });

        this.client = client;
        return client;
      } catch (err: any) {
        gramjsMonitor.recordUploadError(err?.name || "INIT_FAILED");
        console.error("[mtproto] Failed to initialize TelegramClient:", err?.message || err);
        throw err;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.idleTimer = setTimeout(() => {
      this.disconnectIfIdle().catch(() => undefined);
    }, this.IDLE_DISCONNECT_MS);
    this.idleTimer.unref();
  }

  public async disconnectIfIdle(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.client) {
      try {
        if (this.client.connected) {
          await this.client.disconnect();
        }
      } catch {
        // Ignore disconnect error
      } finally {
        this.client = null;
        triggerGC();
        console.info("[mtproto] Idle timeout reached (60s). Disconnected GramJS client and triggered GC.");
      }
    }
  }

  private async executeWithFloodWaitRetry<T>(
    operation: () => Promise<T>,
    onFloodWaitNotice?: (seconds: number) => void
  ): Promise<T> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    try {
      return await operation();
    } catch (err: any) {
      const isFloodWait =
        err?.errorMessage?.startsWith("FLOOD_WAIT_") ||
        err?.name === "FloodWaitError" ||
        typeof err?.seconds === "number";

      if (isFloodWait) {
        const waitSec =
          err?.seconds ||
          Number(err?.errorMessage?.replace("FLOOD_WAIT_", "")) ||
          5;

        gramjsMonitor.recordFloodWait(waitSec);
        console.warn(`[mtproto] FLOOD_WAIT caught (${waitSec}s). Pausing...`);

        if (onFloodWaitNotice) {
          onFloodWaitNotice(waitSec);
        }

        // Wait the required seconds + small safety jitter
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000 + 1000));

        // Retry once after waiting
        return await operation();
      }

      // Record non-flood error
      const errName = err?.name || err?.errorMessage || "UPLOAD_ERROR";
      gramjsMonitor.recordUploadError(errName);
      throw err;
    } finally {
      this.resetIdleTimer();
    }
  }

  async sendVideo(
    chatId: number | string,
    videoPath: string,
    caption: string,
    thumbnailPath?: string,
    progressCallback?: (percentage: number) => void,
    videoMeta?: VideoMetadata,
    onFloodWaitNotice?: (seconds: number) => void
  ): Promise<UploadResponse> {
    const client = await this.getClient();
    const { Api } = await import("telegram");

    const attributes: any[] = [];
    attributes.push(
      new Api.DocumentAttributeVideo({
        duration: videoMeta?.duration || 0,
        w: videoMeta?.width || 0,
        h: videoMeta?.height || 0,
        supportsStreaming: true
      })
    );

    return await this.executeWithFloodWaitRetry(async () => {
      const message = await client.sendFile(chatId, {
        file: videoPath,
        caption,
        thumb: thumbnailPath,
        supportsStreaming: true,
        attributes,
        parseMode: "html",
        workers: 1, // Single worker strictly enforced for 256MB RAM environment
        progressCallback: progressCallback
          ? (progress: number) => progressCallback(Math.round(progress * 100))
          : undefined
      });
      return { messageId: message.id, chatId };
    }, onFloodWaitNotice);
  }

  async sendAudio(
    chatId: number | string,
    audioPath: string,
    caption: string,
    thumbnailPath?: string,
    progressCallback?: (percentage: number) => void,
    audioMeta?: AudioMetadata,
    onFloodWaitNotice?: (seconds: number) => void
  ): Promise<UploadResponse> {
    const client = await this.getClient();
    const { Api } = await import("telegram");

    const attributes: any[] = [];
    attributes.push(
      new Api.DocumentAttributeAudio({
        duration: audioMeta?.duration || 0,
        title: audioMeta?.title || undefined,
        performer: audioMeta?.performer || undefined,
        voice: false
      })
    );

    return await this.executeWithFloodWaitRetry(async () => {
      const message = await client.sendFile(chatId, {
        file: audioPath,
        caption,
        thumb: thumbnailPath,
        attributes,
        parseMode: "html",
        workers: 1, // Single worker strictly enforced for 256MB RAM environment
        progressCallback: progressCallback
          ? (progress: number) => progressCallback(Math.round(progress * 100))
          : undefined
      });
      return { messageId: message.id, chatId };
    }, onFloodWaitNotice);
  }

  async sendPhoto(
    chatId: number | string,
    photoPath: string,
    caption: string,
    onFloodWaitNotice?: (seconds: number) => void
  ): Promise<UploadResponse> {
    const client = await this.getClient();

    return await this.executeWithFloodWaitRetry(async () => {
      const message = await client.sendFile(chatId, {
        file: photoPath,
        caption,
        parseMode: "html",
        workers: 1
      });
      return { messageId: message.id, chatId };
    }, onFloodWaitNotice);
  }

  async sendDocument(
    chatId: number | string,
    filePath: string,
    caption: string,
    onFloodWaitNotice?: (seconds: number) => void
  ): Promise<UploadResponse> {
    const client = await this.getClient();

    return await this.executeWithFloodWaitRetry(async () => {
      const message = await client.sendFile(chatId, {
        file: filePath,
        caption,
        forceDocument: true,
        parseMode: "html",
        workers: 1
      });
      return { messageId: message.id, chatId };
    }, onFloodWaitNotice);
  }
}
