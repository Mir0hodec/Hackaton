import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';
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
      <header>
        <img src="/icon-192.png" alt="" width="64" height="64" />
        <div>
          <span className="eyebrow">НАРЯДAI · WI-FI</span>
          <h1>Подключить iPhone</h1>
        </div>
      </header>
      <p>Одна демо-смена на ноутбуке, iPhone и Android. Подключите устройства к одной Wi-Fi-сети.</p>
      <section className="lan-connect-card">
        <QrCode value={link} size={248} />
        <h2>Наведите камеру iPhone</h2>
        <p>Откройте ссылку в Safari. IP вводить не нужно.</p>
        <a className="primary" href={link}>
          Открыть демо
        </a>
        <small>{link}</small>
      </section>
      <section className="lan-connect-card">
        <h2>Добавить значок на экран</h2>
        <ol>
          <li>В Safari нажмите «Поделиться».</li>
          <li>Выберите «На экран Домой».</li>
          <li>Если есть «Открывать как веб-приложение», включите и нажмите «Добавить».</li>
        </ol>
        <p>
          На телефоне нажмите «Сменить роль» и выберите исполнителя. Ноутбук остаётся мастером; наряды общие.
        </p>
      </section>
      <details className="lan-connect-card">
        <summary>Ссылка по имени ноутбука не открывается?</summary>
        <p>
          Используйте QR по адресу Wi-Fi. Ноутбук должен оставаться включённым, а Start-LAN — работать.
          Гостевая сеть с изоляцией устройств мешает соединению.
        </p>
        {addresses.map((ip) => (
          <div className="lan-connect-fallback" key={ip}>
            <QrCode value={`http://${ip}:${port}/demo`} size={168} />
            <a href={`http://${ip}:${port}/demo`}>
              {ip}:{port}
            </a>
          </div>
        ))}
      </details>
      <footer>
        Safari открывает ссылку на выбранный ноутбук. Автоматический поиск другого сервера после смены сети
        доступен в нативном iOS-приложении. Для него нужна установка с подписью Apple.
      </footer>
    </main>
  );
}
