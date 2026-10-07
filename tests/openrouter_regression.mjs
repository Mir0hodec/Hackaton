// No external requests or real keys: exercise provider responses and assistant fallbacks locally.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'cloudflare:workers';
import { llmInfo, llmJson } from '../lib/llm';
import { demoContext } from '../lib/context';
import { assistantAnswer, tools } from '../lib/assistant';
import { openRouterChat, OpenRouterError, routerNotice } from '../lib/openrouter';
import { lanAiConfig } from '../scripts/lan-ai-config.mjs';
Object.assign(env, {
  OPENROUTER_API_KEY: 'fixture-only',
  AI_PROVIDER: 'openrouter',
  LOCAL_DEMO_NETWORK: 'true',
  DEMO_ONLY: 'true',
  WORKSPACE_MODE: 'false',
  AI_LAN_ENABLED: 'true',
});
assert.equal(llmInfo().provider, 'openrouter');
assert.equal(demoContext.run({ space: 'public-visitor', user: 'master' }, llmInfo).provider, null);
assert.equal(demoContext.run({ space: 'shared-lan', user: 'master' }, llmInfo).provider, 'openrouter');
env.AI_LAN_ENABLED = 'false';
assert.equal(demoContext.run({ space: 'shared-lan', user: 'master' }, llmInfo).provider, null);
env.AI_LAN_ENABLED = 'true';
env.WORKSPACE_MODE = 'true';
assert.equal(demoContext.run({ space: 'shared-lan', user: 'master' }, llmInfo).provider, null);
env.WORKSPACE_MODE = 'false';
const dir = mkdtempSync(join(tmpdir(), 'router-config-'));
try {
  writeFileSync(
    join(dir, '.dev.vars.lan-ai'),
    'AI_LAN_ENABLED=true\nOPENROUTER_API_KEY="fixture-only"\nINITIAL_USERS=must-not-forward\nINTEGRATION_TOKEN=must-not-forward\n',
  );
  const config = lanAiConfig(dir, {});
  assert.deepEqual(config.secrets, { OPENROUTER_API_KEY: 'fixture-only' });
  assert.equal(config.vars.OPENROUTER_API_KEY, undefined);
  assert.equal(config.vars.INITIAL_USERS, undefined);
  assert.deepEqual(lanAiConfig(dir, { AI_LAN_ENABLED: 'false' }), { vars: {}, secrets: {} });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const opts = {
  apiKey: 'fixture-only',
  model: llmInfo().model,
  messages: [{ role: 'user', content: 'test' }],
};
const completion = (message, finish_reason = 'stop') =>
  Response.json({ model: opts.model, choices: [{ finish_reason, message }] });
for (const [status, code] of [
  [401, 'auth'],
  [402, 'credits'],
  [429, 'rate_limit'],
  [404, 'model'],
  [503, 'provider'],
]) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: 'private upstream payload' } }, { status });
  };
  await assert.rejects(
    openRouterChat(opts),
    (e) => e instanceof OpenRouterError && e.code === code && !routerNotice(e).includes('private'),
  );
  assert.equal(calls, status === 503 ? 2 : 1);
}
globalThis.fetch = async () => {
  throw new DOMException('aborted', 'TimeoutError');
};
await assert.rejects(openRouterChat(opts), (e) => e.code === 'timeout');
globalThis.fetch = async () => completion({ content: 'unfinished' }, 'length');
await assert.rejects(openRouterChat(opts), (e) => e.code === 'invalid_response');
globalThis.fetch = async () => Response.json({ error: { code: 402, message: 'private' } });
await assert.rejects(openRouterChat(opts), (e) => e.code === 'credits');
globalThis.fetch = async () => completion({ content: '{"summary":"ok"}' });
assert.deepEqual(
  await llmJson({ system: 'JSON', parts: [{ type: 'text', text: 'data' }], schema: { type: 'object' } }),
  { summary: 'ok' },
);
const dataset = {
  users: [{ id: 'w1', name: 'Иван Петров', role: 'worker', spec: 'Электрик', onShift: true, brigade: 1 }],
  orders: [],
  equipment: [],
  areas: [],
  codes: [],
  materials: [],
  worklogs: [],
};
assert.equal(
  tools.shift_overview({
    ...dataset,
    users: [...dataset.users, { id: 'blocked', role: 'worker', onShift: true, disabled: true }],
  }).workersOnShift,
  1,
);
let step = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  const body = JSON.parse(options.body);
  assert.ok(!JSON.stringify(body).includes('Иван Петров'));
  assert.ok(!JSON.stringify(body).includes('person@example.com'));
  if (step++ === 0)
    return completion(
      {
        content: null,
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: { name: 'free_workers', arguments: '{"specialty":"Электрик"}' },
          },
        ],
      },
      'tool_calls',
    );
  const tool = body.messages.find((m) => m.role === 'tool');
  assert.equal(tool.tool_call_id, 'call1');
  assert.match(tool.content, /Сотрудник-1/);
  return completion({ content: 'Сотрудник-1 — свободен.' });
};
const answer = await assistantAnswer(dataset, 'Кто свободен? Иван Петров person@example.com', []);
assert.equal(answer.mode, 'ai');
assert.match(answer.text, /Иван Петров/);
assert.deepEqual(answer.used, ['free_workers']);
for (const status of [401, 402, 429, 503]) {
  globalThis.fetch = async () => Response.json({ error: { message: 'private' } }, { status });
  const fallback = await assistantAnswer(dataset, 'Кто свободен из электриков?', []);
  assert.equal(fallback.mode, 'rules');
  assert.match(fallback.text, /Иван Петров/);
  assert.ok(fallback.notice);
  assert.ok(!fallback.notice.includes('private'));
}
step = 0;
globalThis.fetch = async (url, options) => {
  if (step++ === 0) return completion({ content: 'Ungrounded response' });
  assert.match(JSON.parse(options.body).messages.at(-1).content, /free_workers/);
  return completion({ content: 'Сотрудник-1 свободен.' });
};
const grounded = await assistantAnswer(dataset, 'Кто свободен?', []);
assert.equal(grounded.mode, 'ai');
assert.ok(grounded.used.includes('free_workers'));
assert.ok(!grounded.text.includes('Ungrounded'));
step = 0;
globalThis.fetch = async (url, options) => {
  if (step++ === 0)
    return completion(
      {
        content: null,
        tool_calls: [{ id: 'bad', type: 'function', function: { name: '__proto__', arguments: '{}' } }],
      },
      'tool_calls',
    );
  if (step === 2) assert.match(JSON.parse(options.body).messages.at(-1).content, /Неизвестный инструмент/);
  return completion({ content: 'Неизвестный инструмент.' });
};
assert.equal((await assistantAnswer(dataset, 'Привет', [])).mode, 'ai');
console.log(
  'PASS: OpenRouter request/JSON/tool cycle; 401/402/429/5xx/timeouts fallback; masking; tool allowlist; grounding; opt-in LAN and isolated demo; secret allowlist. No external API calls.',
);
