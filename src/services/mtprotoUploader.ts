export interface UploadResponse {
  messageId: number;
  chatId: number | string;
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
          useWSS: false
        });

        await client.start({
          botAuthToken: this.botToken
        });

        this.client = client;
        return client;
      } catch (err) {
        console.error("[mtproto] Failed to initialize TelegramClient:", err);
        throw err;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  async sendVideo(
    chatId: number | string,
    videoPath: string,
    caption: string,
    thumbnailPath?: string,
    progressCallback?: (percentage: number) => void
  ): Promise<UploadResponse> {
    const client = await this.getClient();
    const message = await client.sendFile(chatId, {
      file: videoPath,
      caption,
      thumb: thumbnailPath,
      supportsStreaming: true,
      parseMode: "html",
      workers: 2, // ponytail: 2 workers prevents OOM on 256MB RAM servers
      progressCallback: progressCallback
        ? (progress: number) => progressCallback(Math.round(progress * 100))
        : undefined
    });
    return { messageId: message.id, chatId };
  }

  async sendAudio(
    chatId: number | string,
    audioPath: string,
    caption: string,
    thumbnailPath?: string,
    progressCallback?: (percentage: number) => void
  ): Promise<UploadResponse> {
    const client = await this.getClient();
    const message = await client.sendFile(chatId, {
      file: audioPath,
      caption,
      thumb: thumbnailPath,
      parseMode: "html",
      workers: 2,
      progressCallback: progressCallback
        ? (progress: number) => progressCallback(Math.round(progress * 100))
        : undefined
    });
    return { messageId: message.id, chatId };
  }

  async sendPhoto(
    chatId: number | string,
    photoPath: string,
    caption: string
  ): Promise<UploadResponse> {
    const client = await this.getClient();
    const message = await client.sendFile(chatId, {
      file: photoPath,
      caption,
      parseMode: "html",
      workers: 2
    });
    return { messageId: message.id, chatId };
  }
}
