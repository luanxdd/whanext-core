import {
  join,
  resolve,
} from 'node:path';
import {
  create,
  type CreateOptions,
} from '@/app/create.js';
import {
  type AppEvents,
  type AppHealth,
  type LoginOptions,
  WhaNextApp,
} from '@/app/whanext-app.js';
import type {
  CommandDefinition,
  CommandMiddleware,
} from '@/commands/command.js';
import type {
  CommandErrorHandler,
} from '@/commands/router.js';
import type {
  LoadCommandsOptions,
  LoadCommandsResult,
} from '@/commands/load-commands.js';
import { WhaNextError } from '@/errors/error.js';

export interface MultiAccountOptions extends Omit<CreateOptions, 'accountId'> {
  id: string;
}

export interface CreateMultiOptions extends Omit<CreateOptions, 'accountId' | 'auth' | 'phone' | 'provider'> {
  accounts: readonly MultiAccountOptions[];
  authRoot?: string;
}

export interface MultiLoginOptions extends Omit<LoginOptions, 'onCode'> {
  onCode?: (accountId: string, code: string) => void | Promise<void>;
}

export interface MultiAppHealth extends AppHealth {
  accountId: string;
}

export interface MultiAppEvent<Event extends keyof AppEvents> {
  accountId: string;
  app: WhaNextApp;
  payload: AppEvents[Event];
}

export interface MultiLoadCommandsResult {
  accountId: string;
  result: LoadCommandsResult;
}

export class MultiCommandRouter {
  readonly #apps: ReadonlyMap<string, WhaNextApp>;

  constructor(apps: ReadonlyMap<string, WhaNextApp>) {
    this.#apps = apps;
  }

  command(definition: CommandDefinition): this {
    for (const app of this.#apps.values()) {
      app.commands.command(definition);
    }
    return this;
  }

  use(middleware: CommandMiddleware): this {
    for (const app of this.#apps.values()) {
      app.commands.use(middleware);
    }
    return this;
  }

  onError(handler: CommandErrorHandler): () => void {
    const unsubscribe = [...this.#apps.values()].map((app) => app.commands.onError(handler));
    return () => {
      for (const remove of unsubscribe) remove();
    };
  }

  async load(
    dirPath: string | URL,
    options: LoadCommandsOptions = {},
  ): Promise<readonly MultiLoadCommandsResult[]> {
    return Promise.all([...this.#apps].map(async ([accountId, app]) => ({
      accountId,
      result: await app.commands.load(dirPath, options),
    })));
  }
}

export class WhaNextMultiApp {
  readonly commands: MultiCommandRouter;
  readonly #apps: ReadonlyMap<string, WhaNextApp>;

  constructor(apps: ReadonlyMap<string, WhaNextApp>) {
    this.#apps = apps;
    this.commands = new MultiCommandRouter(apps);
  }

  get size(): number {
    return this.#apps.size;
  }

  get isReady(): boolean {
    return this.#apps.size > 0 && [...this.#apps.values()].every((app) => app.isReady);
  }

  ids(): readonly string[] {
    return [...this.#apps.keys()];
  }

  has(accountId: string): boolean {
    return this.#apps.has(accountId);
  }

  get(accountId: string): WhaNextApp | undefined {
    return this.#apps.get(accountId);
  }

  values(): readonly WhaNextApp[] {
    return [...this.#apps.values()];
  }

  router(): MultiCommandRouter {
    return this.commands;
  }

  on<Event extends keyof AppEvents>(
    event: Event,
    listener: (entry: MultiAppEvent<Event>) => void | Promise<void>,
  ): () => void {
    const unsubscribe = [...this.#apps].map(([accountId, app]) =>
      app.on(event, (payload) => listener({ accountId, app, payload })));

    return () => {
      for (const remove of unsubscribe) remove();
    };
  }

  health(): readonly MultiAppHealth[] {
    return [...this.#apps].map(([accountId, app]) => ({
      accountId,
      ...app.health(),
    }));
  }

  async login(options: MultiLoginOptions = {}): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#apps].map(async ([accountId, app]) => {
        await app.login({
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.onCode
            ? { onCode: (code: string) => options.onCode?.(accountId, code) }
            : {}),
        });
      }),
    );
    const failures = results
      .map((result, index) => ({ result, accountId: this.ids()[index] }))
      .filter((entry): entry is {
        result: PromiseRejectedResult;
        accountId: string;
      } => entry.result.status === 'rejected' && entry.accountId !== undefined);

    if (failures.length === 0) {
      return;
    }

    throw new WhaNextError(
      'CONNECTION_FAILED',
      'One or more WhatsApp accounts could not complete login.',
      {
        cause: new AggregateError(
          failures.map(({ result }) => result.reason),
          'Multi-account login failed.',
        ),
        context: {
          accounts: failures.map(({ accountId }) => accountId),
        },
        recoverable: true,
      },
    );
  }

  async disconnect(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#apps.values()].map((app) => app.disconnect()),
    );
    const failures = results.filter((result): result is PromiseRejectedResult =>
      result.status === 'rejected');

    if (failures.length > 0) {
      throw new WhaNextError(
        'CONNECTION_FAILED',
        'One or more WhatsApp accounts could not disconnect cleanly.',
        {
          cause: new AggregateError(
            failures.map((result) => result.reason),
            'Multi-account disconnect failed.',
          ),
          recoverable: true,
        },
      );
    }
  }
}

export async function createMulti(options: CreateMultiOptions): Promise<WhaNextMultiApp> {
  if (options.accounts.length === 0) {
    throw new WhaNextError(
      'ARGUMENT_INVALID',
      'At least one WhatsApp account is required.',
    );
  }

  const {
    accounts,
    authRoot = './sessions',
    ...shared
  } = options;
  const normalizedIds = new Set<string>();
  const authPaths = new Set<string>();

  for (const account of accounts) {
    validateAccountId(account.id);
    const normalizedId = account.id.toLowerCase();

    if (normalizedIds.has(normalizedId)) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        `The multi-account id "${account.id}" is duplicated.`,
      );
    }

    normalizedIds.add(normalizedId);

    if (account.provider === undefined) {
      const authPath = resolve(account.auth ?? join(authRoot, account.id));

      if (authPaths.has(authPath)) {
        throw new WhaNextError(
          'ARGUMENT_INVALID',
          'Each WhatsApp account must use a different auth directory.',
          { context: { auth: authPath } },
        );
      }

      authPaths.add(authPath);
    }
  }

  const apps = new Map<string, WhaNextApp>();

  for (const account of accounts) {
    const {
      id,
      ...overrides
    } = account;
    const merged = mergeCreateOptions(shared, overrides);

    if (
      merged.mute?.enabled === true
      && merged.mute.store === undefined
      && merged.mute.database === undefined
    ) {
      merged.mute = {
        ...merged.mute,
        database: join('./data', `whanext-${id}.sqlite`),
      };
    }

    const app = await create({
      ...merged,
      accountId: id,
      auth: overrides.auth ?? join(authRoot, id),
    });
    apps.set(id, app);
  }

  return new WhaNextMultiApp(apps);
}

function validateAccountId(accountId: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(accountId)) {
    throw new WhaNextError(
      'ARGUMENT_INVALID',
      'Multi-account ids must use lowercase letters, numbers, underscores or hyphens.',
      { context: { accountId } },
    );
  }
}

function mergeCreateOptions(
  shared: Omit<CreateMultiOptions, 'accounts' | 'authRoot'>,
  account: Omit<MultiAccountOptions, 'id'>,
): CreateOptions {
  const merged: CreateOptions = {
    ...shared,
    ...account,
  };

  if (shared.cache || account.cache) {
    merged.cache = {
      ...shared.cache,
      ...account.cache,
    };
  }

  if (shared.mute || account.mute) {
    merged.mute = {
      ...shared.mute,
      ...account.mute,
    };
  }

  if (shared.router || account.router) {
    merged.router = {
      ...shared.router,
      ...account.router,
    };
  }

  if (shared.reconnect || account.reconnect) {
    merged.reconnect = {
      ...shared.reconnect,
      ...account.reconnect,
    };
  }

  if (
    shared.logger
    && account.logger
    && typeof shared.logger === 'object'
    && typeof account.logger === 'object'
  ) {
    merged.logger = {
      ...shared.logger,
      ...account.logger,
    };
  }

  return merged;
}
