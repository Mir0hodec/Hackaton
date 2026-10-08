// Единый адаптер языковой модели для всех ИИ-модулей НарядAI.
//
// Провайдер выбирается переменными окружения сервера:
//   AI_PROVIDER = claude | openai | openrouter | mock   (по умолчанию — по наличию ключа)
//   ANTHROPIC_API_KEY, AI_MODEL (по умолчанию claude-opus-5-5)
//   OPENAI_API_KEY, OPENAI_MODEL (модель с поддержкой изображений и Responses API)
// Без ключа модули работают на правилах и статистике и явно помечают это в интерфейсе.
// Персональные данные сотрудников перед отправкой заменяются обезличенными метками (redactor).
import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';
import { namespace } from './context';
import { isLanDemo } from './lan-mode';
import { openRouterChat } from './openrouter';

export type LlmPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string };

type Provider = 'claude' | 'openai' | 'openrouter' | 'mock';

export function llmInfo(): { provider: Provider | null; model: string | null } {
  const conf = env as any;
  if (
    namespace() &&
    !(namespace() === 'demo:shared-lan:' && isLanDemo(conf) && conf.AI_LAN_ENABLED === 'true')
  )
    return { provider: null, model: null }; // Public demo visitors cannot spend the server key.
  const wanted = String(conf.AI_PROVIDER || '').toLowerCase();
  if ((wanted === 'openrouter' || !wanted) && conf.OPENROUTER_API_KEY)
    return {
      provider: 'openrouter',
      model: conf.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
    };
  if (wanted === 'mock') return { provider: 'mock', model: 'mock' };
  if ((wanted === 'claude' || !wanted) && conf.ANTHROPIC_API_KEY)
    return { provider: 'claude', model: conf.AI_MODEL || 'claude-opus-5-5' };
  if ((wanted === 'openai' || !wanted) && conf.OPENAI_API_KEY && conf.OPENAI_MODEL)
    return { provider: 'openai', model: conf.OPENAI_MODEL };
  return { provider: null, model: null };
}

export const llmEnabled = () => !!llmInfo().provider;

/** Заменяет ФИО, e-mail и телефоны на нейтральные метки перед отправкой во внешний сервис. */
export function redactor(people: { name?: string }[]) {
  const names = people
    .map((p) => String(p.name || '').trim())
    .filter((n) => n.length > 2)
    .sort((a, b) => b.length - a.length);
  // Фамилия может стоять в другом падеже («Петрову», «Ахметова Е.»): ищем по основе.
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const surnames = names
    .map((n) => n.split(/\s+/)[1])
    .filter((s): s is string => !!s && s.length >= 3)
    .map(
      (s) =>
        new RegExp(`(?<![а-яё])${escape(s.length > 4 ? s.slice(0, -1) : s)}[а-яё]{0,3}(?![а-яё])`, 'giu'),
    );
  return (text: unknown) => {
    let t = String(text ?? '');
    for (const name of names) t = t.replaceAll(name, '[сотрудник]');
    for (const re of surnames) t = t.replace(re, '[сотрудник]');
    return t.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/\+?\d[\d ()-]{8,}\d/g, '[номер]');
  };
}

export class LlmUnavailable extends Error {}

/**
 * Запрос к модели со строгой JSON-схемой ответа. Возвращает разобранный объект.
 * mock — детерминированный ответ для локальных тестов конвейера без ключа.
 */
export async function llmJson<T>(opts: {
  system: string;
  parts: LlmPart[];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  mock?: () => T;
}): Promise<T> {
  const { provider, model } = llmInfo();
  const conf = env as any;
  if (!provider || !model) throw new LlmUnavailable('LLM не подключена');
  if (provider === 'mock') {
    if (!opts.mock) throw new LlmUnavailable('Нет тестового ответа');
    return opts.mock();
  }
  if (provider === 'openrouter') {
    const result = await openRouterChat({
      apiKey: conf.OPENROUTER_API_KEY,
      model,
      messages: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content: opts.parts.map((p) =>
            p.type === 'text'
              ? { type: 'text', text: p.text }
              : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
          ),
        },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'result', strict: true, schema: opts.schema },
      },
      maxTokens: opts.maxTokens ?? 4000,
      timeoutMs: 35_000,
    });
    return JSON.parse(result.text) as T;
  }
  if (provider === 'claude') {
    const client = new Anthropic({ apiKey: conf.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 90_000 });
    const response = await client.beta.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: [
        {
          role: 'user',
          content: opts.parts.map((p) =>
            p.type === 'text'
              ? { type: 'text' as const, text: p.text }
              : {
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: p.mediaType as any, data: p.data },
                },
          ),
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: opts.schema },
        effort: opts.effort ?? 'medium',
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') throw new LlmUnavailable('Модель отказалась отвечать');
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return JSON.parse(text) as T;
  }
  // OpenAI Responses API со строгой JSON-схемой.
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + conf.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: opts.maxTokens ?? 4000,
      instructions: opts.system,
      input: [
        {
          role: 'user',
          content: opts.parts.map((p) =>
            p.type === 'text'
              ? { type: 'input_text', text: p.text }
              : { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.data}` },
          ),
        },
      ],
      text: { format: { type: 'json_schema', name: 'result', strict: true, schema: opts.schema } },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new LlmUnavailable('Сервис ИИ недоступен: HTTP ' + response.status);
  const body: any = await response.json();
  const text = body.output
    ?.flatMap((item: any) => item.content || [])
    .filter((x: any) => x.type === 'output_text')
    .map((x: any) => x.text)
    .join('');
  return JSON.parse(text) as T;
}
