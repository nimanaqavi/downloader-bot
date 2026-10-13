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
    thumbnailPath?: string
  ): Promise<void> {
    const client = await this.getClient();
    await client.sendFile(chatId, {
      file: videoPath,
      caption,
      thumb: thumbnailPath,
      supportsStreaming: true,
      workers: 2 // ponytail: 2 workers prevents OOM on 256MB RAM servers while maintaining fast upload
    });
  }

  async sendAudio(
    chatId: number | string,
    audioPath: string,
    caption: string,
    thumbnailPath?: string
  ): Promise<void> {
    const client = await this.getClient();
    await client.sendFile(chatId, {
      file: audioPath,
      caption,
      thumb: thumbnailPath,
      workers: 2 // ponytail: 2 workers prevents OOM on 256MB RAM servers
    });
  }
}
