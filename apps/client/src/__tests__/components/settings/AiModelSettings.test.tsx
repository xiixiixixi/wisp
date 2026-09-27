/**
 * AI 设置页 —— ZCode 式：服务列表 + 表单 + 「添加模型」为独立弹窗
 * （模型 ID / 上下文窗口 / 最大输出 Token）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 内存版 pi 配置存储 —— 保存真的写进去，列表真的读出来
const store = { providers: {} as Record<string, { name?: string; baseUrl?: string; api?: string; apiKey?: string; models?: { id: string }[] }> };
const authKeys: Record<string, string> = {};

vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
  transport: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'pi_config_state') {
      return {
        models_path: '/models.json',
        auth_path: '/auth.json',
        models_json: JSON.parse(JSON.stringify(store)),
        auth_status: Object.entries(authKeys).map(([provider, has]) => ({
          provider, has_key: Boolean(has),
        })),
      };
    }
    if (cmd === 'pi_auth_keys') return { ...authKeys };
    if (cmd === 'pi_config_write_models') {
      store.providers = (args!.modelsJson as typeof store).providers;
      return;
    }
    if (cmd === 'pi_config_set_auth_key') {
      authKeys[args!.provider as string] = args!.apiKey as string;
      return;
    }
    throw new Error(`unexpected transport: ${cmd}`);
  }),
}));

beforeEach(() => {
  store.providers = {};
  for (const k of Object.keys(authKeys)) delete authKeys[k];
});

import AiModelSettings from '@/components/settings/AiModelSettings';

describe('AiModelSettings', () => {
  it('empty state: one add-provider button, no vendor names, no form', () => {
    render(<AiModelSettings />);
    expect(screen.getByTestId('pi-add-provider')).toBeInTheDocument();
    for (const vendor of ['Anthropic', 'MiniMax', 'DeepSeek', 'GLM', 'Kimi']) {
      expect(screen.queryByText(new RegExp(vendor))).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('pi-service-form')).not.toBeInTheDocument();
  });

  it('add opens the form with url/protocol/key fields and empty model list', () => {
    render(<AiModelSettings />);
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    expect(screen.getByTestId('pi-service-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://api.example.com/v1')).toBeInTheDocument();
    expect(screen.getByText(/还没有模型|No models yet/i)).toBeInTheDocument();
  });

  it('add-model dialog: only model id required; limits optional (留空=自动)', () => {
    render(<AiModelSettings />);
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    fireEvent.click(screen.getByTestId('pi-add-model'));
    // 必填只有模型 ID；上下文/输出留空 = 自动（对齐 ZCode/pi/opencode 的行为）
    expect(screen.getByPlaceholderText(/deepseek-chat/)).toBeInTheDocument();
    // 上下文/输出直接平铺可见（留空 = 自动），无需展开
    expect(screen.getAllByPlaceholderText(/自动|Auto/i).length).toBe(2);
    fireEvent.change(screen.getByPlaceholderText(/deepseek-chat/), { target: { value: 'my-model' } });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    expect(screen.queryByPlaceholderText(/deepseek-chat/)).not.toBeInTheDocument();
    expect(screen.getByText('my-model')).toBeInTheDocument();
    expect(screen.getAllByText(/自动|Auto/i).length).toBeGreaterThan(0);   // 留空 → 自动徽标
  });
});

describe('AiModelSettings 多供应商', () => {
  it('保存一个服务后按钮回归，可以继续添加第二个', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    render(<AiModelSettings />);

    // 第一个服务
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
      target: { value: 'https://api.deepseek.com' },
    });
    fireEvent.click(screen.getByTestId('pi-add-model'));
    fireEvent.change(screen.getByPlaceholderText('deepseek-chat'), {
      target: { value: 'deepseek-chat' },
    });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));   // 弹窗：先加模型行
    fireEvent.click(screen.getByTestId('pi-service-save'));        // 表单：保存服务

    // 列表出现第一个服务；添加按钮回归
    expect(await screen.findByTestId('pi-service-api.deepseek.com')).toBeInTheDocument();
    expect(screen.getByTestId('pi-add-provider')).toBeInTheDocument();

    // 第二个服务（不同域名 → 不同 provider id）
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
      target: { value: 'https://api.minimaxi.com' },
    });
    fireEvent.click(screen.getByTestId('pi-add-model'));
    fireEvent.change(screen.getByPlaceholderText('deepseek-chat'), {
      target: { value: 'MiniMax-M2.7' },
    });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    fireEvent.click(screen.getByTestId('pi-service-save'));

    expect(await screen.findByTestId('pi-service-api.minimaxi.com')).toBeInTheDocument();
    expect(screen.getByTestId('pi-service-api.deepseek.com')).toBeInTheDocument();
    // 两个服务都在列表里
    expect(screen.getAllByTestId(/^pi-service-/).length).toBe(2);
  });
});

describe('AiModelSettings 编辑模型', () => {
  it('铅笔打开弹窗带出原值，改名后保存回同一行', () => {
    render(<AiModelSettings />);
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    // 加两个模型
    fireEvent.click(screen.getByTestId('pi-add-model'));
    fireEvent.change(screen.getByPlaceholderText('deepseek-chat'), { target: { value: 'model-a' } });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    fireEvent.click(screen.getByTestId('pi-add-model'));
    fireEvent.change(screen.getByPlaceholderText('deepseek-chat'), { target: { value: 'model-b' } });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    expect(screen.getByText('model-a')).toBeInTheDocument();
    expect(screen.getByText('model-b')).toBeInTheDocument();

    // 编辑第一行
    fireEvent.click(screen.getByTestId('pi-edit-model-0'));
    const input = screen.getByDisplayValue('model-a');
    fireEvent.change(input, { target: { value: 'model-a2' } });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));

    // 原名消失、新名在第一行位置；第二行不受影响
    expect(screen.queryByText('model-a')).not.toBeInTheDocument();
    const rows = screen.getAllByText(/model-a2|model-b/);
    expect(rows.map((r) => r.textContent)).toEqual(['model-a2', 'model-b']);
  });
});

describe('AiModelSettings 思考程度', () => {
  it('弹窗可选思考档位，关闭时 models.json 里 reasoning=false', async () => {
    const writes: unknown[] = [];
    const { transport } = await import('@/lib/transport');
    (transport as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'pi_config_state')
          return {
            models_path: '/m', auth_path: '/a',
            models_json: JSON.parse(JSON.stringify(store)),
            auth_status: [],
          };
        if (cmd === 'pi_config_write_models') {
          writes.push(args!.modelsJson);
          store.providers = (args!.modelsJson as typeof store).providers;
          return;
        }
        throw new Error(`unexpected: ${cmd}`);
      },
    );

    render(<AiModelSettings />);
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
      target: { value: 'https://api.deepseek.com' },
    });
    // 加模型 → 思考程度选「关闭」
    fireEvent.click(screen.getByTestId('pi-add-model'));
    fireEvent.change(screen.getByPlaceholderText('deepseek-chat'), {
      target: { value: 'ds-chat' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: /思考程度|Thinking/i }));
    // Radix 异步挂载选项
    fireEvent.click(await screen.findByRole('option', { name: /关闭|Off/i }));
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    fireEvent.click(screen.getByTestId('pi-service-save'));

    await screen.findByTestId('pi-service-api.deepseek.com');
    expect(writes.length).toBeGreaterThan(0);
    const model = (writes.at(-1) as typeof store).providers['api.deepseek.com'].models?.[0];
    expect(model?.reasoning).toBe(false);
    expect((model as { thinkingLevel?: string }).thinkingLevel).toBeUndefined();
  });
});
