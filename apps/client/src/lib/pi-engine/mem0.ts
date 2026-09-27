/**
 * mem0 云记忆 —— 薄传输层。
 *
 * 自动记忆双钩子在 engine.ts：每轮 prompt 前检索相关记忆注入系统提示
 * （recall，带 2.5s 超时不阻塞发送），每轮结束后把用户消息+助手回复
 * 送去 mem0 后台提炼（capture，fire-and-forget）。钥匙和 HTTP 都在
 * Rust 侧（mem0.rs），WebView 不碰 CORS。
 */
import { transport, isTauri } from '@/lib/transport';

export interface Mem0ConfigState {
  enabled: boolean;
  has_key: boolean;
  user_id: string;
  auto_capture: boolean;
}

export interface Mem0Hit {
  id: string;
  memory: string;
  score: number | null;
  categories: string[];
}

let cachedState: Mem0ConfigState | null = null;
let stateLoadedAt = 0;
const STATE_TTL_MS = 5_000;

export const invalidateMem0State = (): void => {
  cachedState = null;
};

export const mem0State = async (): Promise<Mem0ConfigState | null> => {
  if (!isTauri()) return null;
  if (cachedState && Date.now() - stateLoadedAt < STATE_TTL_MS) return cachedState;
  try {
    cachedState = await transport<Mem0ConfigState>('mem0_config_state');
    stateLoadedAt = Date.now();
    return cachedState;
  } catch {
    return null;
  }
};

/** 检索相关云记忆（不打断发送：超时/失败都返回空）。 */
export const mem0Recall = async (query: string, limit = 5): Promise<Mem0Hit[]> => {
  const state = await mem0State();
  if (!state?.enabled) return [];
  try {
    return await Promise.race([
      transport<Mem0Hit[]>('mem0_search', { query, limit }),
      new Promise<Mem0Hit[]>((resolve) => setTimeout(() => resolve([]), 2500)),
    ]);
  } catch {
    return [];
  }
};

/** 送一轮对话去 mem0 后台提炼（fire-and-forget）。 */
export const mem0Capture = (userText: string, assistantText: string): void => {
  if (!isTauri()) return;
  void mem0State()
    .then((state) => {
      if (!state?.enabled || !state.auto_capture) return;
      return transport('mem0_add', { userText, assistantText });
    })
    .catch(() => undefined);
};
