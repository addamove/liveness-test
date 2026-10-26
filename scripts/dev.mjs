import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { networkInterfaces, hostname } from 'node:os';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';

const root = fileURLToPath(new URL('../', import.meta.url));
const certDir = path.join(root, '.certs');
mkdirSync(certDir, { recursive: true, mode: 0o700 });
const ips = [...new Set(Object.entries(networkInterfaces()).filter(([name]) => !/^(utun|tun|bridge|docker|veth)/.test(name)).flatMap(([, entries]) => entries.filter(e => e.family === 'IPv4' && !e.internal).map(e => e.address)))];
const address = ips[0] || '127.0.0.1';
function openssl(args) {
  const result = spawnSync('openssl', args, { cwd: certDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Не удалось создать HTTPS-сертификат. Установите openssl.\n${result.stderr || result.error}`);
}
if (!existsSync(path.join(certDir, 'root.key')) || process.argv.includes('--renew-ca')) {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '365', '-subj', '/CN=V Kadre Local Demo CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  chmodSync(path.join(certDir, 'root.key'), 0o600);
}
openssl(['x509', '-in', 'root.pem', '-outform', 'der', '-out', 'root.cer']);
const names = ['DNS:localhost', `DNS:${hostname()}`, 'IP:127.0.0.1', ...ips.map(ip => `IP:${ip}`)].join(',');
writeFileSync(path.join(certDir, 'server.ext'), `subjectAltName=${names}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=V Kadre Local Demo']);
chmodSync(path.join(certDir, 'server.key'), 0o600);
openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'server.pem', '-days', '30', '-extfile', 'server.ext']);
const httpsPort = 5173, setupPort = 5174;
const demoUrl = `https://${address}:${httpsPort}`;
const setupUrl = `http://${address}:${setupPort}`;
const qr = await QRCode.toString(setupUrl, { type: 'svg', color: { dark: '#243620', light: '#f5f5ef' }, margin: 1 });
const setupHtml = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>В кадре — подключить телефон</title><style>*{box-sizing:border-box}body{font:16px/1.6 Arial,sans-serif;color:#263321;background:#f5f5ef;max-width:640px;margin:40px auto;padding:0 24px}h1{font-size:36px;line-height:1.1;letter-spacing:-1.5px}h2{font-size:20px}svg{width:180px;display:block;margin:24px 0}a{color:#4d752e}a.button{display:inline-block;background:#d5fa78;border-radius:12px;padding:12px 18px;text-decoration:none;color:#21351b}li{padding:6px 0}.muted{font-size:13px;color:#7e8974}code{font-size:14px;word-break:break-all}section{border-top:1px solid #dce2d3;margin-top:30px;padding-top:10px}</style><h1>Откройте камеру<br>на телефоне.</h1><p>Компьютер и телефон должны быть в одной Wi-Fi сети. Сканируйте QR-код, чтобы открыть эту инструкцию на телефоне.</p>${qr}<code>${setupUrl}</code><section><h2>1. Доверьте локальному сертификату</h2><p>Для камеры нужен доверенный HTTPS. Установите сертификат <b>V Kadre Local Demo CA</b>, созданный только для этого прототипа.</p><a class="button" href="/root.cer">Скачать сертификат</a><p><b>iPhone / iPad:</b></p><ol><li>Откройте эту страницу в Safari и скачайте сертификат.</li><li>Настройки → Основные → VPN и управление устройством → V Kadre Local Demo CA → Установить.</li><li>Настройки → Основные → Об этом устройстве → Доверие сертификатам → включите полное доверие для V Kadre Local Demo CA.</li></ol><p><b>Android:</b> скачайте сертификат. Настройки → Безопасность → Шифрование и учётные данные → Установить сертификат → Сертификат ЦС. Названия зависят от производителя.</p><p class="muted">После теста удалите этот сертификат из настроек устройства. Не передавайте файлы .certs/*.key.</p></section><section><h2>2. Откройте демо</h2><a class="button" href="${demoUrl}">Перейти к съёмке →</a><p><code>${demoUrl}</code></p><p class="muted">Разрешите камеру. Не используйте встроенный браузер мессенджера. При предупреждении о сертификате проверьте настройку доверия выше. Если страница недоступна, проверьте Wi-Fi, VPN и разрешение входящих подключений для Node.js.</p></section><section><h2>На этом компьютере</h2><p>Для проверки без установки сертификата запустите <code>npm run dev:http</code> и откройте <a href="http://localhost:5175">http://localhost:5175</a>.</p></section></html>`;
const setup = createServer((req, res) => {
  if (req.url === '/root.cer') { res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="v-kadre-local-ca.cer"', 'Cache-Control': 'no-store' }); res.end(readFileSync(path.join(certDir, 'root.cer'))); }
  else if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(setupHtml); }
  else { res.writeHead(404); res.end('Not found'); }
});
setup.on('error', error => { console.error(`Страница подключения: ${error.message}`); process.exit(1); });
setup.listen(setupPort, '0.0.0.0');
const vite = await createViteServer({ root, server: { host: '0.0.0.0', port: httpsPort, strictPort: true, https: { key: readFileSync(path.join(certDir, 'server.key')), cert: readFileSync(path.join(certDir, 'server.pem')) } } });
await vite.listen();
console.log(`\nВ КАДРЕ — локальный прототип\n\nПодключить телефон: ${setupUrl}\nДемо (HTTPS):       ${demoUrl}\n`);
for (const ip of ips.slice(1)) console.log(`Другой интерфейс:   https://${ip}:${httpsPort}`);
console.log(await QRCode.toString(setupUrl, { type: 'terminal', small: true }));
console.log('Оба устройства — в одной сети. Инструкция по сертификату — на странице подключения.\nCtrl+C — остановить серверы.');
async function close() { await vite.close(); setup.close(); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
