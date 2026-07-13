import { Telegraf, Context } from 'telegraf';
import type { MilestoneEvent } from '@kingdomos/core';

export interface TelegramCommanderConfig {
  /** Telegram bot token from BotFather */
  bot_token: string;
  /**
   * Allowed Telegram chat IDs — only these chats can issue commands.
   * If empty, all chats are allowed (not recommended for production).
   */
  allowed_chat_ids?: number[];
  /** Verbose logging */
  verbose?: boolean;
}

/** Callbacks the host process must provide so TelegramCommander can control the run. */
export interface TelegramCommanderHooks {
  /** Start the run (summon all agents). Returns a message to send back. */
  onRun: (objective: string) => Promise<string>;
  /** Return current status as a human-readable string. */
  onStatus: () => Promise<string>;
  /** Pause job dispatch. Returns confirmation message. */
  onPause: () => Promise<string>;
  /** Resume job dispatch after pause. Returns confirmation message. */
  onResume: () => Promise<string>;
  /** Stop the run entirely. Returns confirmation message. */
  onStop: () => Promise<string>;
  /** Generate a summary report. Returns report string. */
  onReport: () => Promise<string>;
}

/**
 * TelegramCommander: Telegram bot that enables remote control of a KingdomOS run.
 *
 * Commands:
 *   /run <objective>   — Start a new run with the given objective
 *   /status            — Show current run status
 *   /pause             — Pause job dispatch
 *   /resume            — Resume job dispatch
 *   /stop              — Stop the run
 *   /report            — Get a full summary report
 *   /help              — List available commands
 *
 * Milestone push notifications are sent automatically when milestones fire.
 */
export class TelegramCommander {
  private bot: Telegraf;
  private notifyChatIds = new Set<number>();

  constructor(
    private config: TelegramCommanderConfig,
    private hooks: TelegramCommanderHooks
  ) {
    this.bot = new Telegraf(config.bot_token);

    // Pre-populate allowed chats as notification targets
    for (const id of config.allowed_chat_ids ?? []) {
      this.notifyChatIds.add(id);
    }

    this.registerCommands();
  }

  /** Start polling for Telegram updates. Call once after summon. */
  start(): void {
    this.bot.launch();
    if (this.config.verbose) {
      console.log('[TelegramCommander] Bot started, polling for messages');
    }
  }

  /** Stop polling. Call on shutdown. */
  stop(): void {
    this.bot.stop('SIGTERM');
  }

  /**
   * Push a milestone notification to all registered chats.
   * Wire this as the MilestoneCallback in JobDispatcher and OrchestrationLoop.
   */
  async notifyMilestone(event: MilestoneEvent): Promise<void> {
    const message = formatMilestoneMessage(event);
    if (!message) return;
    await this.broadcast(message);
  }

  /** Send a message to all registered chats. */
  async broadcast(message: string): Promise<void> {
    for (const chatId of this.notifyChatIds) {
      try {
        await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (err) {
        if (this.config.verbose) {
          console.error(`[TelegramCommander] Failed to send to ${chatId}: ${(err as Error).message}`);
        }
      }
    }
  }

  private isAllowed(ctx: Context): boolean {
    const allowed = this.config.allowed_chat_ids;
    if (!allowed || allowed.length === 0) return true;
    const chatId = ctx.chat?.id;
    return chatId !== undefined && allowed.includes(chatId);
  }

  private registerCommands(): void {
    const guard = (ctx: Context, next: () => Promise<void>) => {
      if (!this.isAllowed(ctx)) {
        return ctx.reply('⛔ Unauthorized. This Kingdom does not recognise your banner.');
      }
      // Register this chat for milestone notifications
      if (ctx.chat?.id) this.notifyChatIds.add(ctx.chat.id);
      return next();
    };

    this.bot.use(guard);

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '*KingdomOS Remote Commander*\n\n' +
        '`/run <objective>` — Start a new run\n' +
        '`/status` — Current run status\n' +
        '`/pause` — Pause job dispatch\n' +
        '`/resume` — Resume job dispatch\n' +
        '`/stop` — Stop the run\n' +
        '`/report` — Full summary report',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('run', async (ctx) => {
      const objective = ctx.message.text.replace(/^\/run\s*/i, '').trim();
      if (!objective) {
        await ctx.reply('Usage: `/run <objective description>`', { parse_mode: 'Markdown' });
        return;
      }
      await ctx.reply(`👑 Summoning the Kingdom for: _${objective.slice(0, 80)}_...`, { parse_mode: 'Markdown' });
      try {
        const result = await this.hooks.onRun(objective);
        await ctx.reply(result);
      } catch (err) {
        await ctx.reply(`❌ Error: ${(err as Error).message}`);
      }
    });

    this.bot.command('status', async (ctx) => {
      try {
        const result = await this.hooks.onStatus();
        await ctx.reply(result, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`❌ Error: ${(err as Error).message}`);
      }
    });

    this.bot.command('pause', async (ctx) => {
      try {
        const result = await this.hooks.onPause();
        await ctx.reply(result);
      } catch (err) {
        await ctx.reply(`❌ Error: ${(err as Error).message}`);
      }
    });

    this.bot.command('resume', async (ctx) => {
      try {
        const result = await this.hooks.onResume();
        await ctx.reply(result);
      } catch (err) {
        await ctx.reply(`❌ Error: ${(err as Error).message}`);
      }
    });

    this.bot.command('stop', async (ctx) => {
      await ctx.reply('⚠️ Stopping the Kingdom...');
      try {
        const result = await this.hooks.onStop();
        await ctx.reply(result);
      } catch (err) {
        await ctx.reply(`❌ Error: ${(err as Error).message}`);
      }
    });

    this.bot.command('report', async (ctx) => {
      try {
        const result = await this.hooks.onReport();
        await ctx.reply(result, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`❌ Error: ${(err as Error).message}`);
      }
    });

    // Error handler
    this.bot.catch((err) => {
      if (this.config.verbose) {
        console.error('[TelegramCommander] Bot error:', err);
      }
    });
  }
}

function formatMilestoneMessage(event: MilestoneEvent): string | null {
  switch (event.type) {
    case 'escalation': {
      const { from_tier, to_tier, reasons, stuck_detected } = event.details as Record<string, unknown>;
      const prefix = stuck_detected ? '🔁 Stuck detected — ' : '⬆️ ';
      const title = event.taskTitle ? `_${event.taskTitle.slice(0, 60)}_` : event.taskId ?? '';
      const reasonList = Array.isArray(reasons) ? reasons.slice(0, 2).join('; ') : '';
      return `${prefix}Escalated ${from_tier} → ${to_tier}\n${title}\n_${reasonList}_`;
    }
    case 'task_stuck': {
      const title = event.taskTitle ? `_${event.taskTitle.slice(0, 60)}_` : event.taskId ?? '';
      return `🚫 Task stuck — all tiers exhausted\n${title}`;
    }
    case 'objective_complete': {
      const desc = String((event.details as Record<string, unknown>).description ?? '');
      return `✅ Objective complete!\n_${desc.slice(0, 100)}_`;
    }
    case 'run_failed': {
      const { total_objectives, failed } = event.details as Record<string, unknown>;
      return `❌ Run failed — ${failed}/${total_objectives} objectives failed`;
    }
    default:
      return null;
  }
}

export type { MilestoneEvent };
