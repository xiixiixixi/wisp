/**
 * CLI agent launcher utilities.
 *
 * Spawns external AI CLI tools (Claude Code, Codex, custom commands)
 * in new PTY sessions. The terminal agent detector will automatically
 * pick up the running process.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { emitCliAgentLaunched } from './cli-launch-bus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliAgentResult {
  /** PTY session ID for tracking */
  sessionId: string;
  /** Human-readable label for the terminal tab */
  label: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cliCounter = 0;

const generateSessionId = (prefix: string): string => {
  cliCounter++;
  return `cli-${prefix}-${Date.now()}-${cliCounter}`;
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

/**
 * Give the login shell a moment to finish init before typing the launch
 * command — writing immediately after spawn can lose the first keystrokes
 * while zsh/bash is still loading its profile.
 */
const SHELL_INIT_DELAY_MS = 600;

const quoteArg = (arg: string): string => `"${arg.replace(/"/g, '\\"')}"`;

/**
 * Spawn a PTY, then write the initial command after a short delay so the
 * shell has finished initialising.
 *
 * Right after spawn, notifies the terminal panel to attach a labelled tab to
 * this session (before any output starts flowing).
 */
const spawnWithCommand = async (
  sessionId: string,
  cwd: string,
  command: string,
  label: string,
): Promise<void> => {
  await TauriAPI.ptySpawn(sessionId, cwd, DEFAULT_COLS, DEFAULT_ROWS);
  emitCliAgentLaunched({ sessionId, label });

  // Send the command followed by a newline to execute it
  if (command) {
    await new Promise((resolve) => setTimeout(resolve, SHELL_INIT_DELAY_MS));
    await TauriAPI.ptyWrite(sessionId, `${command}\n`);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch Claude Code CLI in a new PTY session.
 *
 * @param workingDir - Directory to run `claude` from
 * @param prompt     - Optional initial prompt to pass via stdin
 */
export const launchClaudeCode = async (
  workingDir: string,
  prompt?: string,
): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('claude');
  const command = prompt ? `claude ${quoteArg(prompt)}` : 'claude';

  await spawnWithCommand(sessionId, workingDir, command, 'Claude Code');

  return { sessionId, label: 'Claude Code' };
};

/**
 * Launch OpenAI Codex CLI in a new PTY session.
 *
 * @param workingDir - Directory to run `codex` from
 * @param prompt     - Optional initial prompt to pass via stdin
 */
export const launchCodex = async (workingDir: string, prompt?: string): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('codex');
  const command = prompt ? `codex ${quoteArg(prompt)}` : 'codex';

  await spawnWithCommand(sessionId, workingDir, command, 'Codex');

  return { sessionId, label: 'Codex' };
};

/**
 * Launch Google Gemini CLI in a new PTY session.
 *
 * @param workingDir - Directory to run `gemini` from
 * @param prompt     - Optional initial prompt to pass via stdin
 */
export const launchGeminiCli = async (
  workingDir: string,
  prompt?: string,
): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('gemini');
  const command = prompt ? `gemini ${quoteArg(prompt)}` : 'gemini';

  await spawnWithCommand(sessionId, workingDir, command, 'Gemini CLI');

  return { sessionId, label: 'Gemini CLI' };
};

/**
 * Launch OpenCode in a new PTY session. The TUI takes no initial prompt
 * argument, so it always starts bare (in the interactive zsh the user's
 * proxy alias resolves the binary).
 */
export const launchOpenCode = async (workingDir: string): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('opencode');

  await spawnWithCommand(sessionId, workingDir, 'opencode', 'OpenCode');

  return { sessionId, label: 'OpenCode' };
};

/**
 * Launch an arbitrary CLI command in a new PTY session.
 *
 * @param workingDir - Directory to run the command from
 * @param command    - Full CLI command string to execute
 * @param prompt     - Optional initial prompt, appended as a quoted argument
 *                     (works for agents that accept a positional prompt)
 */
export const launchCustomCli = async (
  workingDir: string,
  command: string,
  prompt?: string,
): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('custom');

  const fullCommand = prompt ? `${command} ${quoteArg(prompt)}` : command;
  // Use the first token of the command as label
  const label = command.split(/\s+/)[0] || 'Custom CLI';
  await spawnWithCommand(sessionId, workingDir, fullCommand, label);

  return { sessionId, label };
};
