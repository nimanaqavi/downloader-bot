import { gramjsMonitor } from "./gramjsMonitor.js";

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

  constructor(
    private readonly apiId: number,
    private readonly apiHash: string,
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
        const client = new TelegramClient(stringSession, this.apiId, this.apiHash, {
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

  private async executeWithFloodWaitRetry<T>(
    operation: () => Promise<T>,
    onFloodWaitNotice?: (seconds: number) => void
  ): Promise<T> {
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
        workers: 2, // 2 workers optimal for 256MB RAM
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
        workers: 2,
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
        workers: 2
      });
      return { messageId: message.id, chatId };
    }, onFloodWaitNotice);
  }
}
