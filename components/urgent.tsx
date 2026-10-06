'use client';
// Звуковые сигналы и полноэкранное предупреждение об аварийном наряде.
import { TriangleAlert, Check, X } from 'lucide-react';
import { t } from '../lib/i18n';

let audio: AudioContext | null = null;

/** Браузеры разрешают звук только после действия пользователя: создаём контекст при первом касании. */
export function unlockAudio() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  audio ??= new Ctx();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}

function tone(freq: number, start: number, duration: number, volume = 0.25) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audio.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(audio.currentTime + start);
  osc.stop(audio.currentTime + start + duration);
}

export function playAlarm() {
  unlockAudio();
  for (let i = 0; i < 3; i++) {
    tone(880, i * 0.5, 0.22);
    tone(660, i * 0.5 + 0.25, 0.22);
  }
  navigator.vibrate?.([400, 150, 400, 150, 800]);
}

export function playChime() {
  unlockAudio();
  tone(988, 0, 0.12, 0.12);
  tone(1319, 0.13, 0.18, 0.12);
}

export function UrgentBanner({
  title,
  text,
  canAccept,
  busy,
  onAccept,
  onOpen,
  onClose,
}: {
  title: string;
  text: string;
  canAccept: boolean;
  busy: boolean;
  onAccept: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="urgent-overlay" role="alertdialog" aria-modal="true" aria-label={title}>
      <section className="urgent-banner">
        <TriangleAlert size={56} strokeWidth={2.2} />
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="urgent-actions">
          {canAccept && (
            <button className="primary" disabled={busy} onClick={onAccept}>
              <Check /> {t('Принять наряд')}
            </button>
          )}
          <button onClick={onOpen}>{t('Открыть наряд')}</button>
          <button className="text-button" onClick={onClose} aria-label="Закрыть предупреждение">
            <X size={18} /> {t('Позже')}
          </button>
        </div>
      </section>
    </div>
  );
}
