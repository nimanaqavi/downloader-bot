import crypto from "node:crypto";
import type { Telegraf } from "telegraf";
import type { SettingsRepository } from "../database/repositories/settings.js";
import type { BotContext } from "../types/index.js";
import { escapeHtml } from "../utils/formatting.js";

interface PendingJoinRequest {
  userId: number;
  messageText: string;
  statusMsgId?: number;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingJoinRequest>();
let lastAdminWarningTime = 0;

function cleanupExpiredRequests(): void {
  const now = Date.now();
  for (const [id, req] of pendingRequests.entries()) {
    if (now - req.timestamp > 10 * 60 * 1000) {
      pendingRequests.delete(id);
    }
  }
}

export class ForceJoinService {
  constructor(private readonly settings: SettingsRepository) {}

  async checkMembership(
    bot: Telegraf<BotContext>,
    userId: number,
    adminIds: Set<string>,
    messageText: string
  ): Promise<{ isAllowed: boolean; joinPrompt?: { text: string; keyboard: any } }> {
    // 1. Admins are exempt
    if (adminIds.has(String(userId))) {
      return { isAllowed: true };
    }

    // 2. Check if feature is enabled
    if (!this.settings.isForceJoinEnabled()) {
      return { isAllowed: true };
    }

    const channel = this.settings.getForceJoinChannel();
    if (!channel) {
      return { isAllowed: true };
    }

    const channelUsername = channel.replace(/^https:\/\/t\.me\//, "").replace(/^@/, "");
    const formattedChannel = `@${channelUsername}`;

    try {
      const member = await bot.telegram.getChatMember(formattedChannel, userId);
      const activeStatuses = new Set(["creator", "administrator", "member", "restricted"]);

      if (activeStatuses.has(member.status)) {
        return { isAllowed: true };
      }

      // User is not a member (e.g. left or kicked)
      cleanupExpiredRequests();
      const reqId = crypto.randomBytes(4).toString("hex");
      pendingRequests.set(reqId, {
        userId,
        messageText,
        timestamp: Date.now()
      });

      const text = [
        "<b>📢 عضویت در کانال الزامی است</b>",
        "<blockquote>جهت استفاده از ربات و دریافت فایل، لطفاً ابتدا در کانال زیر عضو شوید، سپس روی دکمه «بررسی عضویت ✓» بزنید:</blockquote>"
      ].join("\n\n");

      const channelUrl = `https://t.me/${channelUsername}`;
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔗 عضویت در کانال", url: channelUrl }],
            [{ text: "بررسی عضویت ✓", callback_data: `fj:check:${reqId}` }]
          ]
        }
      };

      return { isAllowed: false, joinPrompt: { text, keyboard } };
    } catch (err: any) {
      console.warn("[force join] getChatMember check failed:", err?.message || err);

      // Alert admins at most once per 30 minutes if bot is not admin in the channel
      const now = Date.now();
      if (now - lastAdminWarningTime > 30 * 60 * 1000) {
        lastAdminWarningTime = now;
        for (const adminId of adminIds) {
          const numId = Number(adminId);
          if (!isNaN(numId) && numId > 0) {
            bot.telegram
              .sendMessage(
                numId,
                `⚠️ <b>هشدار جوین اجباری:</b>\nربات در کانال <code>${escapeHtml(formattedChannel)}</code> عضو یا ادمین نیست.\nجهت جلوگیری از اختلال در کار کاربران، قفل موقتاً غیرفعال شد.`,
                { parse_mode: "HTML" }
              )
              .catch(() => undefined);
          }
        }
      }

      // Do NOT lock users if check fails
      return { isAllowed: true };
    }
  }

  getPendingRequest(reqId: string): PendingJoinRequest | undefined {
    return pendingRequests.get(reqId);
  }

  consumePendingRequest(reqId: string): PendingJoinRequest | undefined {
    const req = pendingRequests.get(reqId);
    pendingRequests.delete(reqId);
    return req;
  }
}
