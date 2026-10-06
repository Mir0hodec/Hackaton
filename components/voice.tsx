'use client';
// Голосовой ввод (ТЗ, бонус): распознавание речи браузера (Chrome на Android, Safari на iOS).
// Текст дописывается в поле с указанным id; работает и для управляемых, и для обычных полей.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

function appendToField(id: string, text: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  const value = (el.value ? el.value.trimEnd() + ' ' : '') + text.trim();
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function VoiceButton({ target, lang = 'ru-RU' }: { target: string; lang?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<any>(null);
  useEffect(() => {
    setSupported(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    return () => recognition.current?.abort?.();
  }, []);
  if (!supported) return null;
  function toggle() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new Recognition();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      const text = Array.from(e.results as ArrayLike<any>)
        .map((x: any) => x[0]?.transcript || '')
        .join(' ');
      if (text) appendToField(target, text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  }
  return (
    <button
      type="button"
      className={'voice-button ' + (listening ? 'listening' : '')}
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? 'Остановить диктовку' : 'Надиктовать голосом'}
      title={listening ? 'Говорите… нажмите, чтобы остановить' : 'Надиктовать голосом'}
    >
      {listening ? <MicOff size={20} /> : <Mic size={20} />}
      <span>{listening ? 'Слушаю…' : 'Голосом'}</span>
    </button>
  );
}
