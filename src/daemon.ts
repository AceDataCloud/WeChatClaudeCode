/**
 * daemon.ts - Shared daemon logic used by both the CLI and the Electron app.
 *
 * This module owns all WeChat ↔ Claude message routing.  Neither src/main.ts
 * (CLI) nor electron/main.ts (Electron) need to duplicate this code.
 */

import { WeChatApi } from "./wechat/api.js";
import { type AccountData } from "./wechat/accounts.js";
import { createMonitor, type MonitorCallbacks } from "./wechat/monitor.js";
import { createSender } from "./wechat/send.js";
import {
  downloadImage,
  extractText,
  extractFirstImageUrl,
} from "./wechat/media.js";
import { createSessionStore, type Session } from "./session.js";
import { createPermissionBroker } from "./permission.js";
import { routeCommand, type CommandContext } from "./commands/router.js";
import { claudeQuery, type QueryOptions } from "./claude/provider.js";
import { type Config } from "./config.js";
import { logger } from "./logger.js";
import { MessageType, type WeixinMessage } from "./wechat/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 2048;

function splitMessage(
  text: string,
  maxLen: number = MAX_MESSAGE_LENGTH,
): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n+/, "");
  }
  return chunks;
}

export function extractTextFromItems(
  items: NonNullable<WeixinMessage["item_list"]>,
): string {
  return items
    .map((item) => extractText(item))
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DaemonOptions {
  account: AccountData;
  config: Config;
  /** Called when the WeChat bot session expires (need re-login). */
  onSessionExpired?: () => void;
  /** Called when an incoming user message is received. */
  onMessage?: (fromUserId: string, text: string) => void;
  /** Called every time a reply chunk is sent back to WeChat. */
  onReply?: (toUserId: string, text: string) => void;
  /** Called when Claude requests tool permission. */
  onPermissionRequest?: (toolName: string, toolInput: string) => void;
  /** Called after a permission request is resolved. */
  onPermissionResolved?: (allowed: boolean, toolName: string) => void;
}

export interface DaemonHandle {
  /** Start listening for messages.  Returns when the monitor stops. */
  run: () => Promise<void>;
  /** Stop the monitor (idempotent). */
  stop: () => void;
  /** Resolve the currently pending permission request for this account. */
  resolvePermission: (allowed: boolean) => boolean;
}

/**
 * Create a ready-to-run daemon.
 *
 * Usage:
 *   const daemon = createDaemon({ account, config });
 *   await daemon.run();  // blocks until stopped
 */
export function createDaemon(opts: DaemonOptions): DaemonHandle {
  const { account, config } = opts;

  const api = new WeChatApi(account.botToken, account.baseUrl);
  const sessionStore = createSessionStore();
  const session: Session = sessionStore.load(account.accountId);
  const sender = createSender(api, account.accountId);
  const sharedCtx = { lastContextToken: "" };

  const permissionBroker = createPermissionBroker(async () => {
    try {
      await sender.sendText(
        account.userId ?? "",
        sharedCtx.lastContextToken,
        "⏰ 权限请求超时，已自动拒绝。",
      );
    } catch {}
  });

  const callbacks: MonitorCallbacks = {
    onMessage: async (msg: WeixinMessage) => {
      await handleMessage(
        msg,
        account,
        session,
        sessionStore,
        permissionBroker,
        sender,
        config,
        sharedCtx,
        opts,
      );
    },
    onSessionExpired: () => {
      logger.warn("WeChat session expired");
      opts.onSessionExpired?.();
    },
  };

  const monitor = createMonitor(api, callbacks);

  return {
    run: () => monitor.run(),
    stop: () => monitor.stop(),
    resolvePermission: (allowed: boolean) =>
      permissionBroker.resolvePermission(account.accountId, allowed),
  };
}

// ---------------------------------------------------------------------------
// Internal: message routing
// ---------------------------------------------------------------------------

async function handleMessage(
  msg: WeixinMessage,
  account: AccountData,
  session: Session,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
  sender: ReturnType<typeof createSender>,
  config: Config,
  sharedCtx: { lastContextToken: string },
  opts: DaemonOptions,
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;
  if (!msg.from_user_id || !msg.item_list) return;

  const contextToken = msg.context_token ?? "";
  const fromUserId = msg.from_user_id;
  sharedCtx.lastContextToken = contextToken;

  const userText = extractTextFromItems(msg.item_list);
  const imageItem = extractFirstImageUrl(msg.item_list);

  logger.info("Handling inbound WeChat message", {
    accountId: account.accountId,
    messageId: msg.message_id,
    fromUserId,
    textLength: userText.length,
    hasImage: !!imageItem,
    sessionState: session.state,
  });

  opts.onMessage?.(fromUserId, userText);

  // Concurrency guard
  if (session.state === "processing") {
    if (userText.startsWith("/clear")) {
      await sender.sendText(
        fromUserId,
        contextToken,
        "⏳ 正在处理上一条消息，请稍后再清除会话",
      );
    } else if (!userText.startsWith("/")) {
      await sender.sendText(
        fromUserId,
        contextToken,
        "⏳ 正在处理上一条消息，请稍后...",
      );
    }
    if (!userText.startsWith("/status") && !userText.startsWith("/help"))
      return;
  }

  // Permission approval
  if (session.state === "waiting_permission") {
    const lower = userText.toLowerCase();
    logger.info("Received permission reply from WeChat", {
      accountId: account.accountId,
      fromUserId,
      reply: lower,
    });
    if (lower === "y" || lower === "yes") {
      permissionBroker.resolvePermission(account.accountId, true);
      await sender.sendText(fromUserId, contextToken, "✅ 已允许");
    } else if (lower === "n" || lower === "no") {
      permissionBroker.resolvePermission(account.accountId, false);
      await sender.sendText(fromUserId, contextToken, "❌ 已拒绝");
    } else {
      await sender.sendText(
        fromUserId,
        contextToken,
        "正在等待权限审批，请回复 y 或 n。",
      );
    }
    return;
  }

  // Slash commands
  if (userText.startsWith("/")) {
    const updateSession = (partial: Partial<Session>) => {
      Object.assign(session, partial);
      sessionStore.save(account.accountId, session);
    };

    const ctx: CommandContext = {
      accountId: account.accountId,
      session,
      updateSession,
      clearSession: () => sessionStore.clear(account.accountId),
      text: userText,
    };

    const result = routeCommand(ctx);

    logger.info("Processed slash command", {
      accountId: account.accountId,
      fromUserId,
      command: userText.split(/\s+/, 1)[0],
      handled: result.handled,
      hasReply: !!result.reply,
      hasClaudePrompt: !!result.claudePrompt,
    });

    if (result.handled && result.reply) {
      await sender.sendText(fromUserId, contextToken, result.reply);
      return;
    }

    if (result.handled && result.claudePrompt) {
      await sendToClaude(
        result.claudePrompt,
        imageItem,
        fromUserId,
        contextToken,
        account,
        session,
        sessionStore,
        permissionBroker,
        sender,
        config,
        sharedCtx,
        opts,
      );
      return;
    }

    if (result.handled) return;
  }

  // Plain text / image → Claude
  if (!userText && !imageItem) {
    logger.warn("Unsupported inbound message payload", {
      accountId: account.accountId,
      fromUserId,
      messageId: msg.message_id,
    });
    await sender.sendText(
      fromUserId,
      contextToken,
      "暂不支持此类型消息，请发送文字或图片",
    );
    return;
  }

  await sendToClaude(
    userText,
    imageItem,
    fromUserId,
    contextToken,
    account,
    session,
    sessionStore,
    permissionBroker,
    sender,
    config,
    sharedCtx,
    opts,
  );
}

async function sendToClaude(
  userText: string,
  imageItem: ReturnType<typeof extractFirstImageUrl>,
  fromUserId: string,
  contextToken: string,
  account: AccountData,
  session: Session,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
  sender: ReturnType<typeof createSender>,
  config: Config,
  sharedCtx: { lastContextToken: string },
  opts: DaemonOptions,
): Promise<void> {
  logger.info("Dispatching message to Claude", {
    accountId: account.accountId,
    fromUserId,
    textLength: userText.length,
    hasImage: !!imageItem,
    resumeSessionId: session.sdkSessionId ?? "",
    workingDirectory: session.workingDirectory || config.workingDirectory,
    model: session.model || config.model || "default",
    permissionMode:
      session.permissionMode ?? config.permissionMode ?? "default",
  });

  session.state = "processing";
  sessionStore.save(account.accountId, session);

  try {
    let images: QueryOptions["images"];
    if (imageItem) {
      const base64DataUri = await downloadImage(imageItem);
      if (base64DataUri) {
        const matches = base64DataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          images = [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: matches[1],
                data: matches[2],
              },
            },
          ];
        }
      }
    }

    const queryOptions: QueryOptions = {
      prompt: userText || "请分析这张图片",
      cwd: session.workingDirectory || config.workingDirectory,
      resume: session.sdkSessionId,
      model: session.model,
      permissionMode: session.permissionMode ?? config.permissionMode,
      images,
      onPermissionRequest: async (toolName: string, toolInput: string) => {
        session.state = "waiting_permission";
        sessionStore.save(account.accountId, session);

        const permissionPromise = permissionBroker.createPending(
          account.accountId,
          toolName,
          toolInput,
        );
        opts.onPermissionRequest?.(toolName, toolInput);

        const perm = permissionBroker.getPending(account.accountId);
        if (perm) {
          await sender.sendText(
            fromUserId,
            contextToken,
            permissionBroker.formatPendingMessage(perm),
          );
        }

        const allowed = await permissionPromise;
        opts.onPermissionResolved?.(allowed, toolName);
        session.state = "processing";
        sessionStore.save(account.accountId, session);
        return allowed;
      },
    };

    const result = await claudeQuery(queryOptions);

    logger.info("Claude query returned", {
      accountId: account.accountId,
      fromUserId,
      hasError: !!result.error,
      textLength: result.text.length,
      sessionId: result.sessionId || "",
    });

    if (result.error) {
      await sender.sendText(
        fromUserId,
        contextToken,
        `⚠️ 错误: ${result.error}`,
      );
    } else if (result.text) {
      const chunks = splitMessage(result.text);
      logger.info("Sending Claude reply chunks", {
        accountId: account.accountId,
        fromUserId,
        chunkCount: chunks.length,
      });
      for (const chunk of chunks) {
        await sender.sendText(fromUserId, contextToken, chunk);
        opts.onReply?.(fromUserId, chunk);
      }
    } else {
      await sender.sendText(fromUserId, contextToken, "(Claude 返回了空响应)");
    }

    session.sdkSessionId = result.sessionId || undefined;
    session.state = "idle";
    sessionStore.save(account.accountId, session);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("Error in sendToClaude", { error: errorMsg });
    await sender.sendText(
      fromUserId,
      contextToken,
      `⚠️ 处理消息时出错: ${errorMsg}`,
    );
    session.state = "idle";
    sessionStore.save(account.accountId, session);
  }
}
