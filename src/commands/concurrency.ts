import type {
  CommandConcurrency,
  ConcurrencyStrategy,
} from '@/commands/command.js';
import { WhaNextError } from '@/errors/error.js';

export interface CommandConcurrencyContext {
  command: string;
  messageId: string;
  chatId: string;
  userId: string;
}

export interface CommandQueueTimeoutEvent extends CommandConcurrencyContext {
  key: string;
  queuedForMs: number;
  queueTimeoutMs: number;
  queued: number;
}

export interface CommandQueueFullEvent extends CommandConcurrencyContext {
  key: string;
  maxQueue: number;
  queued: number;
}

export interface CommandConcurrencyHealth {
  running: number;
  queued: number;
  queueTimeouts: number;
  queueRejected: number;
}

export type CommandConcurrencyEvent =
  | { type: 'commandQueueTimeout'; payload: CommandQueueTimeoutEvent }
  | { type: 'commandQueueFull'; payload: CommandQueueFullEvent };

interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
}

interface ExecutionState {
  active: number;
  queue: QueueEntry[];
  controllers: Set<AbortController>;
}

const DEFAULT_MAX_QUEUE = 10;
const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

export class CommandConcurrencyController {
  readonly #states = new Map<string, ExecutionState>();
  readonly #onEvent: ((event: CommandConcurrencyEvent) => void) | undefined;
  #queueTimeouts = 0;
  #queueRejected = 0;

  constructor(onEvent?: (event: CommandConcurrencyEvent) => void) {
    this.#onEvent = onEvent;
  }

  health(): CommandConcurrencyHealth {
    let running = 0;
    let queued = 0;

    for (const state of this.#states.values()) {
      running += state.active;
      queued += state.queue.length;
    }

    return {
      running,
      queued,
      queueTimeouts: this.#queueTimeouts,
      queueRejected: this.#queueRejected,
    };
  }

  async run(
    key: string,
    options: CommandConcurrency | undefined,
    execute: (signal: AbortSignal) => Promise<void>,
    context?: CommandConcurrencyContext,
  ): Promise<void> {
    const strategy = options?.strategy ?? 'parallel';
    if (strategy === 'parallel') {
      await execute(new AbortController().signal);
      return;
    }

    const max = normalizePositiveInteger(options?.max, 1);
    const state = this.#states.get(key) ?? { active: 0, queue: [], controllers: new Set() };
    this.#states.set(key, state);

    if (strategy === 'replace') {
      for (const controller of state.controllers) controller.abort();
      state.controllers.clear();
    } else if (strategy === 'reject' && state.active >= max) {
      throw new WhaNextError('COMMAND_BUSY', 'This command is already running.', {
        context: { key, max },
        recoverable: true,
      });
    } else if (strategy === 'queue' && state.active >= max) {
      await this.#waitForQueue(key, state, options ?? {}, context);
    }

    const controller = new AbortController();
    state.controllers.add(controller);
    state.active += 1;

    try {
      await execute(controller.signal);
    } finally {
      state.controllers.delete(controller);
      state.active -= 1;
      this.#releaseNext(state);

      if (state.active === 0 && state.queue.length === 0) {
        this.#states.delete(key);
      }
    }
  }

  async #waitForQueue(
    key: string,
    state: ExecutionState,
    options: CommandConcurrency,
    context: CommandConcurrencyContext | undefined,
  ): Promise<void> {
    const maxQueue = normalizeQueueLimit(options.maxQueue);

    if (state.queue.length >= maxQueue) {
      this.#queueRejected += 1;
      if (context && Number.isFinite(maxQueue)) {
        this.#onEvent?.({
          type: 'commandQueueFull',
          payload: {
            ...context,
            key,
            maxQueue,
            queued: state.queue.length,
          },
        });
      }
      throw new WhaNextError('COMMAND_QUEUE_FULL', 'This command queue is full.', {
        context: { key, maxQueue, queued: state.queue.length },
        recoverable: true,
      });
    }

    const queueTimeoutMs = normalizeQueueTimeout(options.queueTimeoutMs);

    await new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve,
        reject,
        enqueuedAt: Date.now(),
        settled: false,
      };

      if (queueTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (entry.settled) return;
          entry.settled = true;
          const index = state.queue.indexOf(entry);
          if (index >= 0) state.queue.splice(index, 1);
          const queuedForMs = Date.now() - entry.enqueuedAt;
          this.#queueTimeouts += 1;
          if (context) {
            this.#onEvent?.({
              type: 'commandQueueTimeout',
              payload: {
                ...context,
                key,
                queuedForMs,
                queueTimeoutMs,
                queued: state.queue.length,
              },
            });
          }
          reject(new WhaNextError(
            'COMMAND_QUEUE_TIMEOUT',
            'This command waited too long in the execution queue.',
            {
              context: { key, queuedForMs, queueTimeoutMs },
              recoverable: true,
            },
          ));
        }, queueTimeoutMs);
      }

      state.queue.push(entry);
    });
  }

  #releaseNext(state: ExecutionState): void {
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (!next || next.settled) continue;
      next.settled = true;
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
      return;
    }
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeQueueLimit(value: number | undefined): number {
  if (value === 0) return Number.POSITIVE_INFINITY;
  return normalizePositiveInteger(value, DEFAULT_MAX_QUEUE);
}

function normalizeQueueTimeout(value: number | undefined): number {
  if (value === 0) return 0;
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_QUEUE_TIMEOUT_MS;
  return Math.max(1, Math.floor(value));
}

export function normalizeConcurrencyStrategy(
  strategy: ConcurrencyStrategy | undefined,
): ConcurrencyStrategy {
  return strategy ?? 'parallel';
}
