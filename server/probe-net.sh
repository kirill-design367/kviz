#!/usr/bin/env bash
# AUREA · почему из одного контейнера соединение уходит, а из другого нет.
# Только чтение: ни один контейнер не создаётся, не меняется, не трогается.
#
# Прошлая версия этой пробы врала в двух местах, и оба места исправлены здесь.
#
#   1. Она пользовалась busybox: nc и wget. В aurea-web их нет вовсе, и ветка
#      «инструмента нет» печатала то же самое, что ветка «сосед не ответил».
#      Из-за этого получилось, будто основной сайт не достучался до соседа,
#      хотя проверка там попросту не выполнялась. Теперь отсутствие
#      инструмента называется отсутствием инструмента.
#
#   2. Она мерила время через «date +%s%N». BusyBox не понимает %N, и все
#      замеры выходили нулевыми — «не установлено за 0 мс» означало не мгновенный
#      отказ, а сломанный секундомер.
#
# Поэтому сеть проверяется изнутри контейнера тем языком, который в нём есть:
# python3 в квизе, node в основном сайте. Оба умеют и считать время, и разделять
# TCP и TLS — а это главное, чего не хватало: «таймаут 5 с» не говорит, что
# именно не дошло.
set -uo pipefail

IP="${AUREA_TG_IP:-149.154.166.110}"
HOSTNAME_TG="${AUREA_TG_HOST:-api.telegram.org}"
CTS="${*:-aurea-web aurea-kviz}"
NET="${AUREA_NET:-studio_default}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

line() { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }

# --- тело пробы на двух языках. Делают ровно одно и то же ------------------- #
cat > "$TMP/probe.py" <<'PY'
import socket, ssl, sys, time

host, ip = sys.argv[1], sys.argv[2]
peers = [p.split(":") for p in sys.argv[3:]]

def ms(t): return int((time.monotonic() - t) * 1000)

for addr, port in peers:
    t = time.monotonic()
    s = socket.socket(); s.settimeout(4)
    try:
        s.connect((addr, int(port)))
        print("    сосед %s:%s — отвечает за %d мс" % (addr, port, ms(t)))
    except Exception as exc:
        print("    сосед %s:%s — НЕ отвечает за %d мс (%s)" % (addr, port, ms(t), exc))
    finally:
        s.close()

try:
    t = time.monotonic()
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443)})
    print("    имя %s разрешается за %d мс: %s" % (host, ms(t), ", ".join(addrs)))
except Exception as exc:
    print("    имя %s НЕ разрешается: %s" % (host, exc))
    addrs = []

for addr in sorted(set(addrs) | {ip}):
    fam = socket.AF_INET6 if ":" in addr else socket.AF_INET
    try:
        s = socket.socket(fam); s.settimeout(6)
    except OSError as exc:
        # У контейнеров этой сети IPv6 нет вовсе, и это не отказ связи,
        # а отсутствие семейства адресов. Называем вещи своими именами.
        print("    %s — семейство адресов недоступно (%s)" % (addr, exc))
        continue
    t = time.monotonic()
    try:
        s.connect((addr, 443))
    except Exception as exc:
        print("    %s — TCP не прошёл за %d мс (%s)" % (addr, ms(t), exc))
        s.close()
        continue
    tcp = ms(t)
    t2 = time.monotonic()
    try:
        ctx = ssl.create_default_context()
        w = ctx.wrap_socket(s, server_hostname=host)
        print("    %s — TCP %d мс, TLS %d мс, шифр %s" % (addr, tcp, ms(t2), w.cipher()[0]))
        w.close()
    except Exception as exc:
        print("    %s — TCP прошёл за %d мс, а TLS оборван за %d мс (%s)" % (addr, tcp, ms(t2), exc))
        s.close()
PY

cat > "$TMP/probe.js" <<'JS'
const net = require('net'), tls = require('tls'), dns = require('dns');
const [host, ip, ...peers] = process.argv.slice(2);
const ms = (t) => Date.now() - t;

const tcp = (addr, port, timeout) => new Promise((done) => {
  const t = Date.now();
  const s = net.connect({ host: addr, port: Number(port) });
  s.setTimeout(timeout);
  s.on('connect', () => { done({ ok: true, ms: ms(t), socket: s }); });
  s.on('timeout', () => { s.destroy(); done({ ok: false, ms: ms(t), why: 'таймаут' }); });
  s.on('error', (e) => { done({ ok: false, ms: ms(t), why: e.message }); });
});

(async () => {
  for (const p of peers) {
    const [addr, port] = p.split(':');
    const r = await tcp(addr, port, 4000);
    if (r.ok) { console.log(`    сосед ${p} — отвечает за ${r.ms} мс`); r.socket.destroy(); }
    else console.log(`    сосед ${p} — НЕ отвечает за ${r.ms} мс (${r.why})`);
  }
  let addrs = [];
  try {
    const t = Date.now();
    addrs = (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
    console.log(`    имя ${host} разрешается за ${ms(t)} мс: ${addrs.join(', ')}`);
  } catch (e) { console.log(`    имя ${host} НЕ разрешается: ${e.message}`); }
  for (const addr of [...new Set([...addrs, ip])].sort()) {
    // ВАЖНО: TCP и TLS меряются по отдельности. Прошлая проба накрывала обе
    // фазы одним таймаутом, и «5006 мс» не говорило, какая из них не прошла.
    const r = await tcp(addr, 443, 6000);
    if (!r.ok) { console.log(`    ${addr} — TCP не прошёл за ${r.ms} мс (${r.why})`); continue; }
    await new Promise((done) => {
      const t = Date.now();
      const s = tls.connect({ socket: r.socket, servername: host }, () => {
        console.log(`    ${addr} — TCP ${r.ms} мс, TLS ${ms(t)} мс, шифр ${s.getCipher().name}`);
        s.destroy(); done();
      });
      s.setTimeout(6000, () => { console.log(`    ${addr} — TCP прошёл за ${r.ms} мс, а TLS завис (таймаут ${ms(t)} мс)`); s.destroy(); done(); });
      s.on('error', (e) => { console.log(`    ${addr} — TCP прошёл за ${r.ms} мс, а TLS оборван за ${ms(t)} мс (${e.message})`); done(); });
    });
  }
})();
JS

line "Мост и адреса контейнеров"
BR=$(docker network inspect "$NET" -f '{{printf "br-%.12s" .Id}}' 2>/dev/null)
echo "  интерфейс: ${BR:-не определился}"
HOST_MAC=$(ip link show "$BR" 2>/dev/null | awk '/link\/ether/{print $2}')
echo "  MAC моста: ${HOST_MAC:-?}"
docker network inspect "$NET" -f '{{range .Containers}}  {{.Name}} → {{.IPv4Address}}
{{end}}' 2>/dev/null

# Соседи для проверки: адреса других контейнеров той же сети и порт, который
# у них точно слушает. Нужны, чтобы отделить «кадр не дошёл до соседа»
# от «пакет не ушёл через шлюз»: до соседа кадр идёт по его MAC, шлюз в этом
# не участвует.
peers_for() {
  local me="$1"
  docker network inspect "$NET" -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}
{{end}}' 2>/dev/null | while read -r name addr; do
    [ -n "$name" ] || continue
    [ "$name" = "$me" ] && continue
    addr="${addr%%/*}"
    case "$name" in
      *nginx*) echo "$addr:80" ;;
      *kviz*)  echo "$addr:8787" ;;
      *web*)   echo "$addr:3000" ;;
    esac
  done | tr '\n' ' '
}

for ct in $CTS; do
  line "Контейнер $ct"
  echo "  создан:  $(docker inspect "$ct" -f '{{.Created}}' 2>/dev/null)"
  echo "  запущен: $(docker inspect "$ct" -f '{{.State.StartedAt}}' 2>/dev/null)"

  echo "  таблица соседей (кого контейнер считает шлюзом):"
  docker exec "$ct" sh -c 'cat /proc/net/arp' 2>/dev/null | sed 's/^/    /' \
    || echo "    не прочиталась"

  echo "  маршрут по умолчанию (шлюз в обратном порядке байтов):"
  docker exec "$ct" sh -c "awk 'NR>1 && \$2==\"00000000\" {print \$1, \$3}' /proc/net/route" 2>/dev/null \
    | sed 's/^/    /' || echo "    не прочитался"

  PEERS=$(peers_for "$ct")
  echo "  проверка сети изнутри (соседи: ${PEERS:-нет}):"
  if docker exec "$ct" sh -c 'command -v python3' >/dev/null 2>&1; then
    echo "    инструмент: python3"
    docker exec -i "$ct" python3 - "$HOSTNAME_TG" "$IP" $PEERS < "$TMP/probe.py" 2>&1
  elif docker exec "$ct" sh -c 'command -v node' >/dev/null 2>&1; then
    echo "    инструмент: node"
    docker exec -i "$ct" node - "$HOSTNAME_TG" "$IP" $PEERS < "$TMP/probe.js" 2>&1
  else
    echo "    НИ python3, НИ node в контейнере нет — проверить нечем."
    echo "    Это не отказ сети: просто инструмента нет. Прошлая проба здесь"
    echo "    печатала «не отвечает», и это была неправда."
  fi
done

line "Тот же путь с самого хоста, для сравнения"
if command -v python3 >/dev/null 2>&1; then
  python3 "$TMP/probe.py" "$HOSTNAME_TG" "$IP" 2>&1
else
  echo "  python3 на хосте нет"
fi

line "Нагрузка и таблица соединений"
docker stats --no-stream --format '  {{.Name}}  CPU {{.CPUPerc}}  память {{.MemUsage}}' 2>/dev/null
if [ -r /proc/sys/net/netfilter/nf_conntrack_count ]; then
  echo "  соединений сейчас: $(cat /proc/sys/net/netfilter/nf_conntrack_count) из $(cat /proc/sys/net/netfilter/nf_conntrack_max)"
fi

echo
echo "Проверка закончена. Ничего не изменено."
