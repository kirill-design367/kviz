#!/usr/bin/env bash
# AUREA · почему из docker-сети наружу не уходит, а с хоста уходит.
#
# Только чтение: ни одного правила, файла и контейнера не меняется.
#
# Что мы уже знаем: соседи внутри сети отвечают, имена разрешаются, а TCP
# наружу из контейнера умирает по таймауту, тогда как с хоста тот же адрес
# отвечает за 44 мс. Ни то ни другое не говорит о фильтрации у провайдера:
#
#   • имена разрешает сам Docker внутри сетевого пространства контейнера,
#     а наружу за ответом ходит демон со стороны ХОСТА — поэтому рабочий DNS
#     ничего не доказывает про исходящий путь контейнера;
#   • сосед по подсети — это один мост, без маршрутизации и без подмены
#     адреса, поэтому он работает и при полностью закрытом выходе.
#
# Выход контейнера наружу держится на трёх вещах хоста. Ломается любая — и
# картина ровно та, что мы видим. Скрипт проверяет все три и заодно смотрит,
# какое правило считает наши пакеты.
#
#   1. net.ipv4.ip_forward — если 0, ядро не маршрутизирует чужие пакеты.
#   2. цепочка FORWARD — политика DROP и вычищенные правила Docker
#      (перезагрузка firewalld/ufw, ручной iptables -F) дают именно таймаут.
#   3. MASQUERADE в nat/POSTROUTING — без него пакет уходит с адресом
#      172.18.0.x, и ответ не возвращается никогда.
set -uo pipefail

NET="${AUREA_NET:-studio_default}"
CT="${AUREA_KVIZ_CONTAINER:-aurea-kviz}"
line() { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }

line "1. Маршрутизация в ядре"
echo "  net.ipv4.ip_forward = $(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)   (нужна 1)"
echo "  net.ipv4.conf.all.forwarding = $(cat /proc/sys/net/ipv4/conf/all/forwarding 2>/dev/null)"
BR=$(docker network inspect "$NET" -f '{{printf "br-%.12s" .Id}}' 2>/dev/null)
echo "  мост сети $NET: ${BR:-не определился}"
[ -n "$BR" ] && echo "  forwarding на мосту: $(cat "/proc/sys/net/ipv4/conf/${BR}/forwarding" 2>/dev/null)"
echo "  маршрут по умолчанию на хосте:"
ip route show default 2>/dev/null | sed 's/^/    /'

line "2. Цепочка FORWARD"
echo "  политика: $(iptables -S FORWARD 2>/dev/null | head -1)"
echo "  правила, относящиеся к мосту:"
iptables -S FORWARD 2>/dev/null | grep -E "${BR:-докер}|DOCKER" | sed 's/^/    /' || echo "    ни одного"
echo "  счётчики:"
iptables -L FORWARD -v -n -x 2>/dev/null | head -20 | sed 's/^/    /'

line "3. Подмена адреса (MASQUERADE)"
iptables -t nat -S POSTROUTING 2>/dev/null | sed 's/^/  /'

line "4. Кто ещё правит правилами"
for s in firewalld ufw nftables docker; do
  st=$(systemctl is-active "$s" 2>/dev/null)
  [ -n "$st" ] && printf '  %-10s %s\n' "$s" "$st"
done
if command -v nft >/dev/null 2>&1; then
  echo "  таблицы nftables:"
  nft list tables 2>/dev/null | sed 's/^/    /'
fi

# --- Главное: считаем, кто съедает пакеты -------------------------------- #
# Снимаем счётчики, дёргаем соединение ИЗ контейнера, снимаем ещё раз.
# Выросший счётчик у правила DROP покажет виновника пальцем.
snapshot() { iptables -L FORWARD -v -n -x 2>/dev/null; iptables -t nat -L POSTROUTING -v -n -x 2>/dev/null; }

line "5. Что происходит с пакетом контейнера"
BEFORE=$(mktemp); AFTER=$(mktemp)
snapshot > "$BEFORE"
echo "  пробуем из $CT достучаться до трёх РАЗНЫХ адресов наружу"
echo "  (не только Telegram: если молчат все — дело не в фильтрации Telegram):"
docker exec "$CT" python3 - <<'PY' 2>&1 | sed 's/^/    /'
import socket, time
targets = [
    ("77.88.8.8", 53, "DNS Яндекса"),
    ("1.1.1.1", 443, "Cloudflare"),
    ("149.154.167.220", 443, "Telegram, другой адрес"),
    ("149.154.166.110", 443, "Telegram, прежний адрес"),
]
for host, port, label in targets:
    t = time.monotonic()
    s = socket.socket(); s.settimeout(5)
    try:
        s.connect((host, port))
        print("%-16s %-24s дошло за %d мс" % (host + ":" + str(port), label, (time.monotonic() - t) * 1000))
    except Exception as exc:
        print("%-16s %-24s НЕТ за %d мс (%s)" % (host + ":" + str(port), label, (time.monotonic() - t) * 1000, exc))
    finally:
        s.close()
PY
snapshot > "$AFTER"
echo "  правила, счётчики которых выросли за это время:"
diff <(cat "$BEFORE") <(cat "$AFTER") | grep '^>' | sed 's/^> /    /' || echo "    ни одного (значит пакеты до этих цепочек не доходят)"
rm -f "$BEFORE" "$AFTER"

line "6. Тот же перебор с хоста, для сравнения"
python3 - <<'PY' 2>&1 | sed 's/^/  /'
import socket, time
for host, port, label in [("77.88.8.8", 53, "DNS Яндекса"), ("1.1.1.1", 443, "Cloudflare"),
                          ("149.154.167.220", 443, "Telegram, другой адрес")]:
    t = time.monotonic()
    s = socket.socket(); s.settimeout(5)
    try:
        s.connect((host, port))
        print("%-16s %-24s дошло за %d мс" % (host + ":" + str(port), label, (time.monotonic() - t) * 1000))
    except Exception as exc:
        print("%-16s %-24s НЕТ (%s)" % (host + ":" + str(port), label, exc))
    finally:
        s.close()
PY

line "7. Свободен ли адрес для обхода"
echo "  адрес моста на хосте:"
ip -4 addr show "${BR:-none}" 2>/dev/null | awk '/inet /{print "    " $2}'
if ss -tlnH 2>/dev/null | awk '$4 ~ /:8787$/' | grep -q .; then
  echo "  порт 8787 занят:"; ss -tlnp 2>/dev/null | awk '$4 ~ /:8787$/' | sed 's/^/    /'
else
  echo "  порт 8787 свободен"
fi

echo
echo "Проверка закончена. Ничего не изменено."
