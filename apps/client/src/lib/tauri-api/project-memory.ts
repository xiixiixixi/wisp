import { transport } from '../transport';

/** A CLI agent session recovered from ~/.claude/projects or ~/.codex/sessions. */
export interface ProjectSession {
  id: string;
  agent: 'claude-code' | 'codex';
  title: string;
  startedAt: string;
  lastActivity: string;
  changedFiles: string[];
}

/** Sessions that ran in `cwd`, newest first. Desktop only. */
export const projectMemorySessions = async (cwd: string): Promise<ProjectSession[]> =>
  await transport('project_memory_sessions', { cwd });
