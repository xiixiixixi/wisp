export interface McpEntry {
  [key: string]: unknown;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export class McpConfigError extends Error {
  constructor(
    public reason: string,
    public server = '',
  ) {
    super(reason);
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const optionalFields = new Set(['type', 'command', 'args', 'env', 'url', 'headers', 'enabled']);
const cleanEntry = (entry: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(entry).filter(([key, value]) => value !== null || !optionalFields.has(key)),
  );

/** Accept the common mcpServers document, retaining provider-specific fields. */
export function parseMcpConfig(text: string): Record<string, McpEntry> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new McpConfigError('syntax');
  }
  if (!object(document) || !object(document.mcpServers)) throw new McpConfigError('root');
  if (Object.keys(document).some((key) => key !== 'mcpServers')) {
    throw new McpConfigError('root');
  }
  return Object.fromEntries(
    Object.entries(document.mcpServers).map(([name, source]) => {
      const fail = (reason: string): never => {
        throw new McpConfigError(reason, name);
      };
      if (!name.trim() || !object(source)) return fail('entry');
      const entry = cleanEntry(source);
      const type = entry.type ?? (entry.url !== undefined ? 'http' : 'stdio');
      if (type !== 'stdio' && type !== 'http' && type !== 'streamable-http') return fail('type');
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') return fail('enabled');
      if (
        entry.args !== undefined &&
        (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== 'string'))
      ) {
        return fail('args');
      }
      for (const key of ['env', 'headers']) {
        if (
          entry[key] !== undefined &&
          (!object(entry[key]) ||
            Object.values(entry[key]).some((value) => typeof value !== 'string'))
        ) {
          return fail('fields');
        }
      }
      if (type === 'stdio') {
        if (typeof entry.command !== 'string' || !entry.command.trim() || entry.url !== undefined) {
          return fail('command');
        }
      } else {
        if (typeof entry.url !== 'string' || entry.command !== undefined) return fail('url');
        try {
          if (!['http:', 'https:'].includes(new URL(entry.url).protocol)) return fail('url');
        } catch {
          return fail('url');
        }
      }
      return [
        name,
        {
          ...entry,
          type: type === 'streamable-http' ? 'http' : type,
          enabled: entry.enabled ?? true,
        } as McpEntry,
      ];
    }),
  );
}

export const formatMcpConfig = (servers: Record<string, McpEntry>): string =>
  JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        Object.entries(servers).map(([name, entry]) => [name, cleanEntry(entry)]),
      ),
    },
    null,
    2,
  );
