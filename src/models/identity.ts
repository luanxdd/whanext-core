export function normalizeIdentity(identity: string): string {
  const value = identity.trim().toLowerCase();
  const separator = value.lastIndexOf('@');

  if (separator === -1) {
    return value.replace(/\D/g, '');
  }

  const user = value.slice(0, separator).replace(/:\d+$/, '');
  const rawServer = value.slice(separator + 1);
  const server = rawServer === 'c.us' ? 's.whatsapp.net' : rawServer;
  return `${user}@${server}`;
}

export function identityUsername(identity: string): string {
  const normalized = normalizeIdentity(identity);
  const separator = normalized.lastIndexOf('@');
  return separator === -1 ? normalized : normalized.slice(0, separator);
}

export function identityPhoneNumber(identity: string): string | undefined {
  const normalized = normalizeIdentity(identity);

  if (normalized.endsWith('@lid')) {
    return undefined;
  }

  const username = identityUsername(normalized);
  return /^\d+$/.test(username) ? username : undefined;
}

export function identitiesMatch(left: string, right: string): boolean {
  return normalizeIdentity(left) === normalizeIdentity(right);
}

export function uniqueIdentities(identities: ReadonlyArray<string | null | undefined>): string[] {
  const values = identities.filter((identity): identity is string => Boolean(identity));
  return [...new Map(values.map((identity) => [normalizeIdentity(identity), identity])).values()];
}
