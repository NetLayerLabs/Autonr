import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** packages/agent/.env: the single env file the CLIs load and the Next server reads. */
export const AGENT_ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

const ASSIGNMENT = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const BARE_VALUE = /^[A-Za-z0-9_./:@+-]*$/;

/** Quotes a value only when dotenv needs it; single quotes keep the value literal. */
function formatValue(value: string): string {
  if (BARE_VALUE.test(value)) return value;
  if (/[\r\n]/.test(value)) throw new Error("env values with line breaks are not supported");
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new Error("env values containing both quote characters are not supported");
}

/**
 * Sets `updates` in the text of an env file. Every existing assignment of a key is rewritten in place (dotenv lets the
 * last one win, so leaving one behind could shadow the new value); keys that are not there yet are appended. Comments,
 * blank lines, order and all other lines are kept as they are.
 */
export function applyEnvUpdates(content: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const endsWithNewline = lines.at(-1) === "";
  if (endsWithNewline) lines.pop();

  const written = new Set<string>();
  const rewritten = lines.map(line => {
    const key = ASSIGNMENT.exec(line)?.[2];
    const value = key === undefined ? undefined : pending.get(key);
    if (key === undefined || value === undefined) return line;
    written.add(key);
    return line.replace(/=.*$/, () => `=${formatValue(value)}`);
  });
  const appended = [...pending]
    .filter(([key]) => !written.has(key))
    .map(([key, value]) => `${key}=${formatValue(value)}`);

  const result = [...rewritten, ...appended];
  const trailing = endsWithNewline || appended.length > 0 ? eol : "";
  return `${result.join(eol)}${trailing}`;
}

/** Applies `updates` to the env file at `path`; a new file is created readable by its owner only. */
export async function updateEnvFile(path: string, updates: Record<string, string>): Promise<void> {
  const content = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  await writeFile(path, applyEnvUpdates(content, updates), { mode: 0o600 });
}
