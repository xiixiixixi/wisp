import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeContext, Type, type TranscriptContext } from '@earendil-works/pi-ai';

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
  transport: vi.fn(async () => {
    throw new Error('native configuration must not be read in these tests');
  }),
}));

import { buildPiModels, makeStreamFn, SUPPORTED_API_TYPES } from '@/lib/pi-engine/providers';
import { piFetch, type PiFetch } from '@/lib/pi-engine/fetch';

type TestApi = (typeof SUPPORTED_API_TYPES)[number];

const replyResponse = (api: TestApi): Response => {
  if (api === 'openai-completions') {
    const chunk = {
      id: 'test-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [
        { index: 0, delta: { role: 'assistant', content: 'Test reply' }, finish_reason: 'stop' },
      ],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  const item = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Test reply', annotations: [] }],
  };
  const events =
    api === 'openai-responses'
      ? [
          { type: 'response.created', response: { id: 'resp_test' } },
          { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
          {
            type: 'response.output_text.delta',
            output_index: 0,
            content_index: 0,
            delta: 'Test reply',
          },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.completed',
            response: { id: 'resp_test', status: 'completed', output: [item] },
          },
        ]
      : [
          {
            type: 'message_start',
            message: {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              model: 'test-model',
              content: [],
              stop_reason: null,
              usage: { input_tokens: 3, output_tokens: 0 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Test reply' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 2 },
          },
          { type: 'message_stop' },
        ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
};

describe('pi provider API compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers the real built-in providers with queryable model catalogs', () => {
    const models = buildPiModels();
    const providerIds = [
      'anthropic',
      'openai',
      'openrouter',
      'minimax',
      'deepseek',
      'zai',
      'moonshotai',
    ];

    expect(models.getProviders().map((provider) => provider.id)).toEqual(providerIds);
    for (const id of providerIds) {
      const catalog = models.getModels(id);
      expect(catalog.length, `${id} model catalog`).toBeGreaterThan(0);
      expect(catalog.every((model) => model.provider === id)).toBe(true);
      expect(models.getModel(id, catalog[0].id)).toEqual(catalog[0]);
      expect(models.getProvider(id)?.streamSimple).toBeTypeOf('function');
    }
  });

  it.each(SUPPORTED_API_TYPES)(
    'registers a custom %s provider without replacing built-ins',
    (api) => {
      const models = buildPiModels({
        providers: {
          'test-provider': {
            name: 'Test provider',
            api,
            baseUrl: 'https://provider.example.test/v1',
            models: [
              {
                id: 'test-model',
                name: 'Test model',
                baseUrl: 'https://model.example.test/v1',
                input: ['text', 'image'],
                contextWindow: 256_000,
                maxTokens: 16_384,
                reasoning: true,
                thinkingLevel: 'high',
              },
            ],
          },
        },
      });

      expect(models.getProvider('test-provider')).toMatchObject({
        id: 'test-provider',
        name: 'Test provider',
        baseUrl: 'https://provider.example.test/v1',
      });
      expect(models.getModels('test-provider')).toHaveLength(1);
      expect(models.getModel('test-provider', 'test-model')).toMatchObject({
        id: 'test-model',
        name: 'Test model',
        provider: 'test-provider',
        api,
        baseUrl: 'https://model.example.test/v1',
        input: ['text', 'image'],
        contextWindow: 256_000,
        maxTokens: 16_384,
        reasoning: true,
        thinkingLevel: 'high',
      });
      expect(models.getModels('openai').length).toBeGreaterThan(0);
    },
  );

  it.each(['anthropic', 'openai'])('keeps the %s catalog when overriding its base URL', (id) => {
    const original = buildPiModels().getModels(id);
    const models = buildPiModels({
      providers: { [id]: { baseUrl: 'https://proxy.example.test/v1' } },
    });
    const overridden = models.getModels(id);

    expect(overridden.map((model) => model.id)).toEqual(original.map((model) => model.id));
    expect(overridden.every((model) => model.baseUrl === 'https://proxy.example.test/v1')).toBe(
      true,
    );
    expect(overridden.map((model) => model.api)).toEqual(original.map((model) => model.api));
  });

  it.each(SUPPORTED_API_TYPES)(
    'streams %s through the real registry with transcript instructions, tools, history and resolved key',
    async (api) => {
      const baseUrl =
        api === 'anthropic-messages'
          ? 'https://provider.example.test'
          : 'https://provider.example.test/v1';
      const models = buildPiModels({
        providers: {
          'test-provider': {
            api,
            baseUrl,
            models: [{ id: 'test-model' }],
          },
        },
      });
      const model = models.getModel('test-provider', 'test-model')!;
      const context: TranscriptContext = normalizeContext({
        messages: [
          {
            role: 'system',
            content: 'Test system prompt',
            sections: { wisp_memory: 'Stale test memory' },
            toolsAdded: [
              {
                name: 'read_file',
                description: 'Read a file',
                parameters: Type.Object({ path: Type.String() }),
              },
            ],
            timestamp: 1,
          },
          { role: 'user', content: 'Earlier user message', timestamp: 2 },
          {
            role: 'assistant',
            api,
            provider: 'test-provider',
            model: 'test-model',
            content: [
              {
                type: 'toolCall',
                id: 'call_test_saved',
                name: 'read_file',
                arguments: { path: '/tmp/test-only.txt' },
              },
            ],
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'toolUse',
            timestamp: 3,
          },
          {
            role: 'toolResult',
            toolCallId: 'call_test_saved',
            toolName: 'read_file',
            content: [{ type: 'text', text: 'Existing tool result' }],
            isError: false,
            timestamp: 4,
          },
          {
            role: 'system',
            content: '',
            sections: { wisp_memory: 'Current test memory' },
            timestamp: 5,
          },
          { role: 'user', content: 'Test user message', timestamp: 6 },
        ],
      });
      const keyResolver = vi.fn(() => 'test-only-key');
      const callerFetch = vi.fn(() => {
        throw new Error('caller fetch must be replaced by Wisp fetch');
      });
      const mockFetch = vi.fn<PiFetch>(async () => replyResponse(api));
      vi.stubGlobal('fetch', mockFetch);
      const streamSimple = vi.spyOn(models, 'streamSimple');
      const options = { temperature: 0.2, maxTokens: 64, fetch: callerFetch, apiKey: 'caller-key' };

      const result = await makeStreamFn(models, keyResolver)(model, context, options).result();

      expect(streamSimple).toHaveBeenCalledWith(model, context, {
        ...options,
        fetch: piFetch,
        apiKey: 'test-only-key',
      });
      expect(streamSimple.mock.calls[0][1]).toBe(context);
      expect(keyResolver).toHaveBeenCalledWith('test-provider');
      expect(options.apiKey).toBe('caller-key');
      expect(options.fetch).toBe(callerFetch);
      expect(callerFetch).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [input, init] = mockFetch.mock.calls[0];
      const requestUrl = new URL(String(input));
      expect(requestUrl.origin).toBe('https://provider.example.test');
      expect(requestUrl.pathname).toBe(
        {
          'openai-completions': '/v1/chat/completions',
          'openai-responses': '/v1/responses',
          'anthropic-messages': '/v1/messages',
        }[api],
      );
      const headers = new Headers(init?.headers);
      expect(headers.get(api === 'anthropic-messages' ? 'x-api-key' : 'authorization')).toBe(
        api === 'anthropic-messages' ? 'test-only-key' : 'Bearer test-only-key',
      );
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeTypeOf('string');
      const body = JSON.parse(init!.body as string);
      const effectivePrompt = 'Test system prompt\n\nCurrent test memory';
      expect(body).toMatchObject({ model: 'test-model', temperature: 0.2, stream: true });
      expect(JSON.stringify(body)).not.toContain('Stale test memory');
      if (api === 'openai-completions') {
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: effectivePrompt }),
            expect.objectContaining({ role: 'user', content: 'Test user message' }),
            expect.objectContaining({
              role: 'assistant',
              tool_calls: [
                expect.objectContaining({
                  id: 'call_test_saved',
                  function: { name: 'read_file', arguments: '{"path":"/tmp/test-only.txt"}' },
                }),
              ],
            }),
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'call_test_saved',
              content: 'Existing tool result',
            }),
          ]),
        );
        expect(body.tools).toEqual([
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({
              name: 'read_file',
              parameters: expect.objectContaining({ required: ['path'] }),
            }),
          }),
        ]);
      } else if (api === 'openai-responses') {
        expect(body.input).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: effectivePrompt }),
            expect.objectContaining({
              role: 'user',
              content: [{ type: 'input_text', text: 'Test user message' }],
            }),
            expect.objectContaining({
              type: 'function_call',
              call_id: 'call_test_saved',
              name: 'read_file',
              arguments: '{"path":"/tmp/test-only.txt"}',
            }),
            expect.objectContaining({
              type: 'function_call_output',
              call_id: 'call_test_saved',
              output: 'Existing tool result',
            }),
          ]),
        );
        expect(body.tools).toEqual([
          expect.objectContaining({
            type: 'function',
            name: 'read_file',
            parameters: expect.objectContaining({ required: ['path'] }),
          }),
        ]);
      } else {
        expect(body.system).toEqual([
          expect.objectContaining({ type: 'text', text: effectivePrompt }),
        ]);
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'tool_use',
                  id: 'call_test_saved',
                  name: 'read_file',
                  input: { path: '/tmp/test-only.txt' },
                }),
              ]),
            }),
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'tool_result',
                  tool_use_id: 'call_test_saved',
                  content: 'Existing tool result',
                }),
              ]),
            }),
          ]),
        );
        expect(JSON.stringify(body.messages)).toContain('Test user message');
        expect(body.tools).toEqual([
          expect.objectContaining({
            name: 'read_file',
            input_schema: expect.objectContaining({ required: ['path'] }),
          }),
        ]);
      }
      expect(result.stopReason).toBe('stop');
      expect(result.content).toEqual([
        expect.objectContaining({ type: 'text', text: 'Test reply' }),
      ]);
    },
  );
});
