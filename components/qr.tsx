'use client';
// QR-коды на оборудовании (ТЗ, бонус): этикетки для печати и сканер в форме наряда.
// В коде — ссылка на приложение с id оборудования: её открывает и обычная камера телефона.
import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Printer, ScanLine, X } from 'lucide-react';

export const equipmentLink = (origin: string, id: string) => `${origin}/?eq=${encodeURIComponent(id)}`;

/** Достаёт id оборудования из ссылки QR (или принимает id как есть). */
export function equipmentFromQr(text: string, equipment: any[]) {
  let id = text.trim();
  try {
    id = new URL(text).searchParams.get('eq') || id;
  } catch {}
  return equipment.find((e) => e.id === id || e.inventory === id) || null;
}

export function QrCode({ value, size = 140 }: { value: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c + 2},${r + 2}h1v1h-1z`);
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${n + 4} ${n + 4}`}
      width={size}
      height={size}
      role="img"
      aria-label={'QR-код: ' + value}
      shapeRendering="crispEdges"
    >
      <rect width={n + 4} height={n + 4} fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}

export function QrLabels({ equipment, areas, origin }: { equipment: any[]; areas: any[]; origin: string }) {
  const [area, setArea] = useState('');
  const list = equipment.filter((e) => !area || e.area === area);
  return (
    <div className="qr-labels-page">
      <div className="button-row no-print">
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Участок">
          <option value="">Все участки</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => window.print()}>
          <Printer size={18} /> Печать этикеток
        </button>
      </div>
      <p className="muted small no-print">
        Наклейте этикетку на оборудование. Мастер наводит камеру телефона — открывается быстрый наряд по этому
        оборудованию.
      </p>
      <div className="qr-labels">
        {list.map((e) => (
          <figure key={e.id} className="qr-label">
            <QrCode value={equipmentLink(origin, e.id)} size={120} />
            <figcaption>
              <strong>{e.name}</strong>
              <span>
                {areas.find((a) => a.id === e.area)?.name} · инв. {e.inventory}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** Сканер QR камерой телефона (BarcodeDetector: Chrome на Android). */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Сканер в браузере недоступен. Наведите обычную камеру телефона на QR-код — наряд откроется по ссылке.',
      );
      return;
    }
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const detector = new Detector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              stopped = true;
              navigator.vibrate?.(80);
              onResult(codes[0].rawValue);
              return;
            }
          } catch {}
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setError('Нет доступа к камере. Разрешите камеру в настройках браузера.'));
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="overlay" role="dialog" aria-label="Сканирование QR-кода">
      <section className="modal qr-scanner">
        <header>
          <h2>
            <ScanLine size={20} /> Наведите на QR-код
          </h2>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть сканер">
            <X />
          </button>
        </header>
        {error ? <p className="error">{error}</p> : <video ref={video} playsInline muted />}
      </section>
    </div>
  );
}
