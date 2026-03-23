import type { CommandContext, CommandResult } from "./router.js";

const HELP_TEXT = `可用命令：

  /help           显示帮助
  /clear          清除当前会话
  /model <名称>   切换 Claude 模型
  /status         查看当前会话状态

直接输入文字即可与 Claude Code 对话`;


export function handleHelp(_args: string): CommandResult {
  return { reply: HELP_TEXT, handled: true };
}

export function handleClear(ctx: CommandContext): CommandResult {
  const newSession = ctx.clearSession();
  Object.assign(ctx.session, newSession);
  return { reply: "✅ 会话已清除，下次消息将开始新会话。", handled: true };
}

export function handleModel(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    return {
      reply: "用法: /model <模型名称>\n例: /model claude-sonnet-4-6",
      handled: true,
    };
  }
  ctx.updateSession({ model: args });
  return { reply: `✅ 模型已切换为: ${args}`, handled: true };
}

export function handleStatus(ctx: CommandContext): CommandResult {
  const s = ctx.session;
  const lines = [
    "📊 会话状态",
    "",
    `工作目录: ${s.workingDirectory}`,
    `模型: ${s.model ?? "默认"}`,
    `会话ID: ${s.sdkSessionId ?? "无"}`,
    `状态: ${s.state}`,
  ];
  return { reply: lines.join("\n"), handled: true };
}


