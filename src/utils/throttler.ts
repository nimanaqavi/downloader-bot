interface ThrottleState {
  lastEditTime: number;
}

const messageThrottleMap = new Map<string, ThrottleState>();

export async function safeEditMessageText(
  telegram: any,
  chatId: number | string,
  messageId: number,
  text: string,
  extra?: any,
  minIntervalMs: number = 2000
): Promise<boolean> {
  const key = `${chatId}:${messageId}`;
  const now = Date.now();
  const state = messageThrottleMap.get(key);

  if (state && now - state.lastEditTime < minIntervalMs) {
    return false; // Throttled out to protect Telegram rate limits
  }

  try {
    messageThrottleMap.set(key, { lastEditTime: now });
    await telegram.editMessageText(chatId, messageId, undefined, text, {
      parse_mode: "HTML",
      ...extra
    });
    return true;
  } catch (err: any) {
    const errorMsg = String(err?.message || err);
    // Ignore "message is not modified"
    if (errorMsg.includes("message is not modified")) {
      return true;
    }
    // Respect Telegram 429 flood wait
    if (err?.response?.error_code === 429 || errorMsg.includes("Too Many Requests")) {
      const retryAfter = err?.response?.parameters?.retry_after || 5;
      console.warn(`[telegram 429] Throttled on editMessageText. Waiting ${retryAfter}s`);
      messageThrottleMap.set(key, { lastEditTime: now + retryAfter * 1000 });
      return false;
    }
    return false;
  }
}

export function clearMessageThrottle(chatId: number | string, messageId: number): void {
  messageThrottleMap.delete(`${chatId}:${messageId}`);
}
