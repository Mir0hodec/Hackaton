// Server-only OpenRouter Chat Completions adapter. Never return provider payloads or keys to the browser.
export type RouterMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  tool_calls?: RouterToolCall[];
  tool_call_id?: string;
  reasoning_details?: unknown;
};
export type RouterToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export class OpenRouterError extends Error {
  constructor(
    public code: string,
    public status?: number,
  ) {
    super(code);
    this.name = 'OpenRouterError';
  }
}
export function routerNotice(error: unknown): string {
  const code = error instanceof OpenRouterError ? error.code : 'provider';
  return (
    {
      auth: 'OpenRouter отклонил ключ. Проверьте ключ в настройках сервера.',
      credits: 'Лимит или баланс OpenRouter исчерпан. Проверьте ограничения ключа.',
      rate_limit: 'Достигнут лимит запросов OpenRouter. Повторите вопрос позже.',
      timeout: 'OpenRouter не ответил вовремя. Повторите вопрос.',
      model: 'Выбранная модель OpenRouter недоступна. Проверьте настройки сервера.',
      invalid_response: 'Модель не завершила ответ. Повторите вопрос.',
      provider: 'OpenRouter временно недоступен. Повторите вопрос позже.',
    }[code] || 'Сервис ИИ временно недоступен.'
  );
}
function providerError(status: number) {
  const code =
    status === 401 || status === 403
      ? 'auth'
      : status === 402
        ? 'credits'
        : status === 429
          ? 'rate_limit'
          : status === 400 || status === 404
            ? 'model'
            : 'provider';
  return new OpenRouterError(code, status);
}
export async function openRouterChat(opts: {
  apiKey: string;
  model: string;
  messages: RouterMessage[];
  tools?: unknown[];
  responseFormat?: unknown;
  maxTokens?: number;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + Math.min(35_000, opts.timeoutMs ?? 25_000);
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new OpenRouterError('timeout');
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + opts.apiKey,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'NaryadAI',
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 2000,
          stream: false,
          ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
          ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
          provider: { require_parameters: true },
          // The default free model supports non-reasoning mode; keep phone chat responsive.
          ...(opts.model.startsWith('nvidia/nemotron-3-super-') ? { reasoning: { enabled: false } } : {}),
        }),
        signal: AbortSignal.timeout(left),
      });
      if (response.status >= 500 && attempt === 0 && deadline - Date.now() > 1000) {
        await response.body?.cancel();
        continue;
      }
      const body: any = await response.json();
      if (!response.ok || body.error)
        throw providerError(response.ok ? Number(body.error?.code) || 502 : response.status);
      const choice = body.choices?.[0];
      const message = choice?.message;
      if (!message || choice.finish_reason === 'length' || choice.finish_reason === 'content_filter')
        throw new OpenRouterError('invalid_response');
      if (
        message.tool_calls &&
        (!Array.isArray(message.tool_calls) ||
          message.tool_calls.length > 8 ||
          message.tool_calls.some(
            (call: any) =>
              typeof call.id !== 'string' ||
              call.type !== 'function' ||
              typeof call.function?.name !== 'string' ||
              typeof call.function?.arguments !== 'string',
          ))
      )
        throw new OpenRouterError('invalid_response');
      const text = typeof message.content === 'string' ? message.content.trim() : '';
      if (!text && !message.tool_calls?.length) throw new OpenRouterError('invalid_response');
      return {
        message: {
          role: 'assistant',
          content: text || null,
          ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
          ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}),
        } as RouterMessage,
        text,
        model: String(body.model || opts.model),
      };
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
        throw new OpenRouterError('timeout');
      throw new OpenRouterError('provider');
    }
  }
  throw new OpenRouterError('provider');
}
