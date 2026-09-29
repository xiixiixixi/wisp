import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelsJson } from '@/lib/pi-engine/pi-config';
import AiModelSettings from '@/components/settings/AiModelSettings';

const mock = vi.hoisted(() => ({
  transport: vi.fn(),
  saveMemory: vi.fn(),
  memoryState: vi.fn(),
  memoryList: vi.fn(),
}));
vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
  transport: (...args: unknown[]) => mock.transport(...args),
}));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    mem0ConfigState: (...args: unknown[]) => mock.memoryState(...args),
    mem0SaveConfig: (...args: unknown[]) => mock.saveMemory(...args),
    mem0List: (...args: unknown[]) => mock.memoryList(...args),
  },
}));
vi.mock('@/lib/pi-engine/providers', () => ({ invalidatePiConfig: vi.fn() }));
vi.mock('@/lib/pi-engine/mem0', () => ({ invalidateMem0State: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
let store: ModelsJson;
let failWrite: boolean;
const memory = { enabled: false, has_key: false, user_id: 'wisp', auto_capture: true };
const renderReady = async () => {
  const result = render(<AiModelSettings />);
  await act(async () => {});
  return result;
};
const startService = () => {
  fireEvent.click(screen.getByTestId('pi-add-provider'));
  fireEvent.change(screen.getByLabelText('Service URL'), {
    target: { value: 'https://api.example.com/v1' },
  });
};
const addModel = (name = 'model-a') => {
  fireEvent.click(screen.getByTestId('pi-add-model'));
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: name } });
};

beforeEach(() => {
  vi.clearAllMocks();
  store = { providers: {} };
  failWrite = false;
  mock.transport.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'pi_config_state') {
      return {
        models_json: structuredClone(store),
        auth_status: [],
        models_path: '/m',
        auth_path: '/a',
      };
    }
    if (cmd === 'pi_config_write_models') {
      if (failWrite) throw new Error('disk unavailable');
      store = structuredClone(args.modelsJson as ModelsJson);
      return;
    }
    if (cmd === 'pi_config_remove_auth_key') return;
    throw new Error(cmd);
  });
  mock.memoryState.mockResolvedValue(memory);
  mock.memoryList.mockResolvedValue([]);
  mock.saveMemory.mockResolvedValue(memory);
});

describe('model service settings', () => {
  it('adds a model with app defaults and keeps same-host services separate', async () => {
    await renderReady();
    expect(screen.queryByTestId('pi-service-form')).not.toBeInTheDocument();
    for (const name of ['first', 'second']) {
      startService();
      addModel(name);
      fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
      fireEvent.click(screen.getByTestId('pi-service-save'));
      await waitFor(() => expect(screen.queryByTestId('pi-service-form')).not.toBeInTheDocument());
    }
    expect(Object.keys(store.providers)).toEqual(['api.example.com', 'api.example.com-2']);
    expect(store.providers['api.example.com'].models).toEqual([{ id: 'first', name: 'first' }]);
    expect(store.providers['api.example.com-2'].models?.[0].id).toBe('second');
  });

  it('saves actual length and thinking values while preserving existing capabilities and the saved key', async () => {
    store.providers.saved = {
      name: 'My service',
      apiKey: '$WISP_KEEP_KEY$',
      baseUrl: 'https://api.example.com',
      headers: { 'x-custom': 'keep' },
      modelOverrides: { a: { compat: true } },
      models: [
        {
          id: 'vision',
          name: 'Vision model',
          input: ['text', 'image'],
          reasoning: true,
          contextWindow: 200000,
          maxTokens: 16000,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    };
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: 'Edit My service' }));
    expect(screen.getByLabelText('API key')).toHaveValue('');
    fireEvent.click(screen.getByTestId('pi-edit-model-0'));
    fireEvent.change(screen.getByLabelText('Context window'), { target: { value: '64000' } });
    fireEvent.change(screen.getByLabelText('Maximum reply length'), { target: { value: '4096' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Thinking' }));
    fireEvent.click(await screen.findByRole('option', { name: 'High' }));
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    fireEvent.click(screen.getByTestId('pi-service-save'));
    await waitFor(() => expect(screen.queryByTestId('pi-service-form')).not.toBeInTheDocument());
    expect(store.providers.saved).toMatchObject({
      apiKey: '$WISP_KEEP_KEY$',
      headers: { 'x-custom': 'keep' },
      modelOverrides: { a: { compat: true } },
      models: [
        {
          id: 'vision',
          name: 'Vision model',
          input: ['text', 'image'],
          contextWindow: 64000,
          maxTokens: 4096,
          reasoning: true,
          thinkingLevel: 'high',
          cost: { input: 1, output: 2 },
        },
      ],
    });
  });

  it('keeps the form and key after failed save, then retries successfully', async () => {
    await renderReady();
    startService();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-only-secret' } });
    addModel();
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    failWrite = true;
    fireEvent.click(screen.getByTestId('pi-service-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are kept');
    expect(screen.getByLabelText('API key')).toHaveValue('test-only-secret');
    expect(store.providers).toEqual({});
    failWrite = false;
    fireEvent.click(screen.getByTestId('pi-service-save'));
    await screen.findByTestId('pi-service-api.example.com');
    expect(screen.queryByTestId('pi-service-form')).not.toBeInTheDocument();
  });

  it('rejects impossible model limits and duplicate names before persisting', async () => {
    await renderReady();
    startService();
    addModel();
    fireEvent.change(screen.getByLabelText('Context window'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Maximum reply length'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    expect(screen.getByRole('alert')).toHaveTextContent('cannot exceed');
    fireEvent.change(screen.getByLabelText('Maximum reply length'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    addModel();
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    expect(screen.getByRole('alert')).toHaveTextContent('already in the list');
    expect(mock.transport.mock.calls.some(([cmd]) => cmd === 'pi_config_write_models')).toBe(false);
  });

  it('persists thinking off and exposes named model controls', async () => {
    await renderReady();
    startService();
    addModel();
    fireEvent.click(screen.getByRole('combobox', { name: 'Thinking' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Off' }));
    fireEvent.click(screen.getByTestId('pi-model-dialog-save'));
    expect(screen.getByRole('switch', { name: 'Use model-a' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Delete model-a' })).toBeVisible();
    fireEvent.click(screen.getByTestId('pi-service-save'));
    await screen.findByTestId('pi-service-api.example.com');
    expect(store.providers['api.example.com'].models?.[0]).toMatchObject({ reasoning: false });
    expect(store.providers['api.example.com'].models?.[0]).not.toHaveProperty('thinkingLevel');
  });

  it('requires explicit confirmation before removing a service', async () => {
    store.providers.saved = { baseUrl: 'https://e.test', models: [{ id: 'one' }] };
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved' }));
    expect(store.providers.saved).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.providers.saved).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    await waitFor(() => expect(store.providers.saved).toBeUndefined());
  });

  it('shows cloud-memory privacy details only when requested', async () => {
    await renderReady();
    expect(screen.queryByText(/conversation content is sent to Mem0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About cloud memory' }));
    expect(screen.getByText(/conversation content is sent to Mem0/)).toBeVisible();
  });

  it('retains a failed memory key and permits resetting the profile to wisp', async () => {
    mock.memoryState.mockResolvedValue({ ...memory, enabled: true, user_id: 'custom' });
    mock.saveMemory
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValue({ ...memory, enabled: true, user_id: 'wisp' });
    await renderReady();
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory profile' }), {
      target: { value: 'wisp' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Memory profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your input is kept');
    expect(screen.getByRole('textbox', { name: 'Memory profile' })).toHaveValue('wisp');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Memory profile' }));
    await waitFor(() => expect(mock.saveMemory).toHaveBeenLastCalledWith({ userId: 'wisp' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    mock.saveMemory.mockRejectedValueOnce(new Error('failed'));
    fireEvent.change(screen.getByTestId('mem0-key-input'), {
      target: { value: 'test-memory-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your input is kept');
    expect(screen.getByTestId('mem0-key-input')).toHaveValue('test-memory-key');
  });
});
