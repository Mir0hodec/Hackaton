import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';
import {
  ArrowUpRight,
  Camera,
  ChevronDown,
  Globe,
  Laptop,
  PlusSquare,
  Share2,
  Smartphone,
  Users,
  Wifi,
} from 'lucide-react';
import { QrCode } from '../../components/qr';
import { isLanDemo } from '../../lib/lan-mode';
export const dynamic = 'force-dynamic';
export default function ConnectPhone() {
  const settings = env as any;
  if (!isLanDemo(settings)) notFound();
  const host = String(settings.LOCAL_DEMO_HOST || '');
  const port = Number(settings.LOCAL_DEMO_PORT || 8788);
  if (
    !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.local$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    notFound();
  const link = `http://${host}:${port}/demo`;
  const addresses = String(settings.LOCAL_DEMO_ADDRESSES || '')
    .split(',')
    .filter((ip) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip));
  return (
    <main className="lan-connect">
      <div className="lan-connect-shell">
        <header className="lan-connect-header">
          <a className="lan-connect-brand" href="/demo" aria-label="НарядAI — открыть демо">
            <img src="/icon-192.png" alt="" width="44" height="44" />
            <span>
              <strong>
                Наряд<span>AI</span>
              </strong>
              <small>Управление рабочей сменой</small>
            </span>
          </a>
          <span className="lan-connect-network">
            <Wifi size={16} aria-hidden="true" /> Локальное демо
          </span>
        </header>

        <div className="lan-connect-hero">
          <div className="lan-connect-intro">
            <span className="eyebrow">ОДНА WI-FI-СЕТЬ. ОДНА СМЕНА.</span>
            <h1>Подключить iPhone</h1>
            <p className="lan-connect-lead">
              Наряды с ноутбука — теперь на телефоне. Подключите iPhone к той же Wi-Fi-сети и откройте общую
              демо-смену.
            </p>
            <div className="lan-connect-devices">
              <Laptop size={17} aria-hidden="true" />
              <span>Ноутбук мастера</span>
              <span className="lan-connect-device-line" aria-hidden="true" />
              <Smartphone size={17} aria-hidden="true" />
              <span>Телефон исполнителя</span>
            </div>
          </div>

          <section className="lan-connect-qr-card" aria-labelledby="lan-qr-title">
            <div className="lan-connect-qr-label">
              <Camera size={17} aria-hidden="true" /> БЫСТРОЕ ПОДКЛЮЧЕНИЕ
            </div>
            <div className="lan-connect-qr-frame">
              <QrCode value={link} size={248} />
            </div>
            <h2 id="lan-qr-title">Наведите камеру iPhone</h2>
            <p>
              Нажмите на ссылку под QR-кодом.
              <br />
              Демо откроется в Safari.
            </p>
            <a className="primary lan-connect-open" href="/demo">
              Открыть демо на этом устройстве <ArrowUpRight size={19} aria-hidden="true" />
            </a>
            <div className="lan-connect-server">
              <span>СЕРВЕР СМЕНЫ</span>
              <small>
                {host}:{port}
              </small>
            </div>
          </section>

          <ol className="lan-connect-steps" aria-label="Как подключиться">
            <li>
              <span className="lan-connect-step-number">01</span>
              <div>
                <h2>Откройте камеру</h2>
                <p>Отсканируйте QR-код. На этом телефоне можно сразу нажать «Открыть демо».</p>
              </div>
            </li>
            <li>
              <span className="lan-connect-step-number">02</span>
              <div>
                <h2>Перейдите в Safari</h2>
                <p>Ссылка найдёт ноутбук по имени. Вводить IP-адрес вручную не нужно.</p>
              </div>
            </li>
            <li>
              <span className="lan-connect-step-number">03</span>
              <div>
                <h2>Выберите исполнителя</h2>
                <p>
                  В демо нажмите «Сменить роль». Мастер на ноутбуке и исполнитель на iPhone увидят одни
                  наряды.
                </p>
              </div>
            </li>
          </ol>
        </div>

        <section className="lan-connect-install" aria-labelledby="lan-install-title">
          <div className="lan-connect-install-heading">
            <span className="lan-connect-icon">
              <Smartphone size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 id="lan-install-title">Сохраните на экран «Домой»</h2>
              <p>Следующая смена — в одно касание значка.</p>
            </div>
            <span className="lan-connect-optional">ПО ЖЕЛАНИЮ</span>
          </div>
          <ol className="lan-connect-install-steps">
            <li>
              <Share2 size={21} aria-hidden="true" />
              <div>
                <strong>1. Поделиться</strong>
                <p>Нажмите «Поделиться» в Safari.</p>
              </div>
            </li>
            <li>
              <PlusSquare size={21} aria-hidden="true" />
              <div>
                <strong>2. На экран «Домой»</strong>
                <p>Выберите этот пункт в меню.</p>
              </div>
            </li>
            <li>
              <Globe size={21} aria-hidden="true" />
              <div>
                <strong>3. Добавить</strong>
                <p>Если есть «Открывать как веб-приложение», включите перед добавлением.</p>
              </div>
            </li>
          </ol>
        </section>

        <details className="lan-connect-help">
          <summary>
            <Wifi size={19} aria-hidden="true" />
            <span>Не получается подключиться?</span>
            <ChevronDown size={19} className="lan-connect-chevron" aria-hidden="true" />
          </summary>
          <div className="lan-connect-help-content">
            <p>
              Проверьте, что iPhone и ноутбук подключены к одной Wi-Fi-сети. Ноутбук должен оставаться
              включённым, а Start-LAN — работать. Гостевая сеть может блокировать связь между устройствами.
            </p>
            <p>Если ссылка по имени ноутбука не открывается, используйте адрес Wi-Fi ниже:</p>
            <div className="lan-connect-fallback-list">
              {addresses.map((ip) => (
                <div className="lan-connect-fallback" key={ip}>
                  <QrCode value={`http://${ip}:${port}/demo`} size={144} />
                  <div>
                    <span>АДРЕС В ЛОКАЛЬНОЙ СЕТИ</span>
                    <a href={`http://${ip}:${port}/demo`}>
                      {ip}:{port}
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                    <p>Отсканируйте QR или откройте ссылку.</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
        <footer>
          <Users size={16} aria-hidden="true" />
          <span>Общая демо-смена для iPhone, Android и ноутбука. Работает, пока запущен сервер.</span>
        </footer>
      </div>
    </main>
  );
}
