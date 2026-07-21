import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
}

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const;

export async function loadCommands(
  registrar: CommandRegistrar,
  dirPath: string,
  options: LoadCommandsOptions = {},
): Promise<LoadCommandsResult> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const recursive = options.recursive ?? true;

  const entries = await readEntries(dirPath, recursive);
  const loaded: string[] = [];
  const skipped: string[] = [];

  for (const filePath of entries) {
    if (!extensions.includes(path.extname(filePath))) {
      skipped.push(filePath);
      continue;
    }

    const definition = await importCommand(filePath);
    registrar.command(definition);
    loaded.push(filePath);
  }

  return { loaded, skipped };
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
    .map((dirent) => path.join(dirent.parentPath, dirent.name));
}

async function importCommand(filePath: string): Promise<CommandDefinition> {
  let module: Record<string, unknown>;

  try {
    module = await import(pathToFileURL(filePath).href);
  } catch (error) {
    throw new WhaNextError('COMMAND_LOAD_FAILED', `Could not import the command file "${filePath}".`, {
      cause: error,
      context: { filePath },
    });
  }

  const candidate = module.default ?? Object.values(module)[0];

  if (!isCommandDefinition(candidate)) {
    throw new WhaNextError('COMMAND_LOAD_FAILED', `The file "${filePath}" does not export a valid command.`, {
      context: { filePath },
    });
  }

  return candidate;
}

function isCommandDefinition(value: unknown): value is CommandDefinition {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as CommandDefinition).name === 'string'
    && typeof (value as CommandDefinition).execute === 'function'
  );
}
