// То же самое, но для контейнера основного сайта: там node, а не python.
const dns = require('node:dns');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');

const HOST = 'api.telegram.org';

try {
  console.log('резолвер:');
  for (const line of fs.readFileSync('/etc/resolv.conf', 'utf8').split('\n')) {
    if (line.trim() && !line.startsWith('#')) console.log('   ', line);
  }
} catch (e) {
  console.log('    не прочитался:', e.message);
}

const check = (address, family) =>
  new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: address, port: 443, family }, () => {
      const tcp = Date.now() - started;
      const secure = tls.connect({ socket, servername: HOST }, () => {
        console.log(`    ${address.padEnd(40)} TCP ${tcp} мс, TLS поднялся`);
        secure.destroy();
        resolve();
      });
      secure.on('error', (e) => {
        console.log(`    ${address.padEnd(40)} TLS не поднялся: ${e.message}`);
        resolve();
      });
    });
    socket.setTimeout(5000, () => {
      console.log(`    ${address.padEnd(40)} НЕТ: таймаут (${Date.now() - started} мс)`);
      socket.destroy();
      resolve();
    });
    socket.on('error', (e) => {
      console.log(`    ${address.padEnd(40)} НЕТ: ${e.message} (${Date.now() - started} мс)`);
      resolve();
    });
  });

(async () => {
  for (const [family, name] of [[4, 'IPv4'], [6, 'IPv6']]) {
    let addresses = [];
    try {
      addresses = (await dns.promises.resolve(HOST, family === 4 ? 'A' : 'AAAA')) ?? [];
    } catch (e) {
      console.log(`${name}: резолв не удался — ${e.message}`);
      continue;
    }
    console.log(`${name}: адреса — ${addresses.join(', ') || 'нет'}`);
    for (const address of addresses) await check(address, family);
  }
})();
