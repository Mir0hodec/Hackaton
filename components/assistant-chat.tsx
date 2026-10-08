'use client';
// Чат с ИИ-ассистентом мастера (ТЗ 6.7). Вопросы голосом или текстом.
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles } from 'lucide-react';
import { VoiceButton } from './voice';

type Msg = { role: 'user' | 'assistant'; text: string; mode?: string; provider?: string; notice?: string };
const suggestions = [
  'Кто сейчас свободен из электриков?',
  'Что просрочено на смене?',
  'Сформируй отчёт за неделю по участку обогащения',
  'Что с конвейером К-3?',
  'Покажи проблемы участка дробления за месяц',
];

export function AssistantChat({ api }: { api: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    // Some browsers return a Promise from scrollIntoView; an effect must not return it as cleanup.
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || request.current) return;
    setText('');
    const next = [...messages, { role: 'user' as const, text: q }];
    setMessages(next);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const r = await fetch(api, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, history: messages.slice(-6) }),
      });
      const d: any = await r.json();
      setMessages([
        ...next,
        {
          role: 'assistant',
          text: r.ok ? d.text : d.error,
          mode: d.mode,
          provider: d.provider,
          notice: d.notice,
        },
      ]);
    } catch {
      setMessages([
        ...next,
        {
          role: 'assistant',
          text: controller.signal.aborted
            ? 'Сервер не ответил вовремя. Повторите вопрос.'
            : 'Нет связи с сервером. Проверьте Wi-Fi и повторите вопрос.',
        },
      ]);
    } finally {
      clearTimeout(timeout);
      request.current = null;
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="ИИ-ассистент мастера">
        <Bot size={26} />
        <span>Ассистент</span>
      </button>
    );
  return (
    <section className="assistant-panel" role="dialog" aria-label="ИИ-ассистент мастера">
      <header>
        <h2>
          <Sparkles size={18} /> ИИ-ассистент
        </h2>
        <button className="icon-button" onClick={() => setOpen(false)} aria-label="Закрыть ассистента">
          <X />
        </button>
      </header>
      <div className="assistant-log">
        {!messages.length && (
          <div className="assistant-hello">
            <p>Спросите о смене, людях, нарядах или оборудовании. Ответ строится по данным системы.</p>
            <div className="assistant-chips">
              {suggestions.map((s) => (
                <button key={s} disabled={busy} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'assistant-msg ' + m.role}>
            {m.notice && (
              <p className="assistant-notice" role="status">
                {m.notice}
              </p>
            )}
            <p>{m.text}</p>
            {m.role === 'assistant' && m.mode && (
              <small>
                {m.mode === 'ai'
                  ? `ИИ-модель${m.provider === 'openrouter' ? ' · OpenRouter' : ''} · по данным системы`
                  : 'Ответ по данным системы'}
              </small>
            )}
          </div>
        ))}
        {busy && <div className="assistant-msg assistant typing">Ассистент собирает данные…</div>}
        <div ref={end} />
      </div>
      <form
        className="assistant-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <input
          id="assistant-question"
          aria-label="Вопрос помощнику"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: кто свободен из слесарей?"
          maxLength={1000}
        />
        <VoiceButton target="assistant-question" />
        <button className="primary" disabled={busy || !text.trim()} aria-label="Отправить вопрос">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
