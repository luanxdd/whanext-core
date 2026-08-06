import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { CommandDefinition } from '@/commands/command.js';
import { WhaNextError } from '@/errors/error.js';

export interface CommandRegistrar {
  command(definition: CommandDefinition): unknown;
}

export interface LoadCommandsOptions {
  extensions?: readonly string[];
  recursive?: boolean;
}

export interface LoadCommandsResult {
  loaded: readonly string[];
  skipped: readonly string[];
  commands: readonly LoadedCommand[];
}

export interface LoadedCommand {
  name: string;
  filePath: string;
}

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'] as const;

export async function loadCommands(
  registrar: CommandRegistrar,
  dirPath: string | URL,
  options: LoadCommandsOptions = {},
): Promise<LoadCommandsResult> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const recursive = options.recursive ?? true;
  const resolvedDirPath = dirPath instanceof URL ? fileURLToPath(dirPath) : dirPath;

  const entries = await readEntries(resolvedDirPath, recursive);
  const loaded: string[] = [];
  const skipped: string[] = [];
  const commands: LoadedCommand[] = [];

  for (const filePath of entries) {
    if (isDeclarationFile(filePath) || !extensions.includes(path.extname(filePath))) {
      skipped.push(filePath);
      continue;
    }

    const definitions = await importCommands(filePath);

    for (const definition of definitions) {
      registrar.command(definition);
      commands.push({ name: definition.name, filePath });
    }

    loaded.push(filePath);
  }

  return { loaded, skipped, commands };
}

async function readEntries(dirPath: string, recursive: boolean): Promise<string[]> {
  let dirents: Dirent[];

  try {
    dirents = await readdir(dirPath, { recursive, withFileTypes: true });
  } catch (error) {
    throw new WhaNextError('COMMAND_LOAD_FAILED', `Could not read the commands directory "${dirPath}".`, {
      cause: error,
      context: { dirPath },
    });
  }

  return dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) => path.join(dirent.parentPath, dirent.name))
    .sort((left, right) => left.localeCompare(right));
}

async function importCommands(filePath: string): Promise<CommandDefinition[]> {
  let module: Record<string, unknown>;

  try {
    module = await import(pathToFileURL(filePath).href);
  } catch (error) {
    throw new WhaNextError('COMMAND_LOAD_FAILED', `Could not import the command file "${filePath}".`, {
      cause: error,
      context: { filePath },
    });
  }

  const definitions: CommandDefinition[] = [];
  const seen = new Set<CommandDefinition>();
  const exports = [
    module.default,
    ...Object.entries(module)
      .filter(([name]) => name !== 'default')
      .map(([, value]) => value),
  ];

  for (const value of exports) {
    const candidates = Array.isArray(value) ? value : [value];

    for (const candidate of candidates) {
      if (isCommandDefinition(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        definitions.push(candidate);
      }
    }
  }

  if (definitions.length === 0) {
    throw new WhaNextError('COMMAND_LOAD_FAILED', `The file "${filePath}" does not export any valid commands.`, {
      context: { filePath },
    });
  }

  return definitions;
}

function isCommandDefinition(value: unknown): value is CommandDefinition {
  const candidate = value as Partial<CommandDefinition> & { subcommands?: unknown };
  return (
    typeof value === 'object'
    && value !== null
    && typeof candidate.name === 'string'
    && (
      typeof (candidate as { execute?: unknown }).execute === 'function'
      || Array.isArray(candidate.subcommands)
    )
  );
}

function isDeclarationFile(filePath: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/.test(filePath);
}
