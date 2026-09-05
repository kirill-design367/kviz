#!/usr/bin/env bash
# AUREA · почему из одного контейнера соединение уходит, а из другого нет.
# Только чтение: ни один контейнер не создаётся, не меняется, не трогается.
#
# Проверяются три вещи, которых не было в прошлой пробе:
#
#   1. АДРЕС ШЛЮЗА В ТАБЛИЦЕ СОСЕДЕЙ. Запросы к DNS (127.0.0.11) обслуживает
#      сам Docker внутри сетевого пространства контейнера — шлюз для этого
#      не нужен. А наружу пакет идёт через шлюз, и если в контейнере остался
#      устаревший MAC моста (мост пересоздавался, контейнер живёт с той поры),
#      имена резолвятся, а соединения молча уходят в никуда. Ровно та картина,
#      что мы видим. Сверяем MAC шлюза в контейнерах с настоящим MAC моста.
#
#   2. ФАЗЫ СОЕДИНЕНИЯ ПО ОТДЕЛЬНОСТИ. Прошлая проба на node меряла TCP и TLS
#      одним таймаутом, и «таймаут 5 с» не говорил, что именно не дошло.
#      Здесь TCP и TLS разделены.
#
#   3. ДРУГОЙ ИНСТРУМЕНТ В ТОМ ЖЕ КОНТЕЙНЕРЕ. Если busybox доходит, а node нет,
#      дело не в сети контейнера, а в самом node.
set -uo pipefail

IP="${AUREA_TG_IP:-149.154.166.110}"
CTS="${*:-aurea-web aurea-kviz}"

line() { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }

line "Настоящий MAC моста на хосте"
BR=$(docker network inspect studio_default -f '{{printf "br-%.12s" .Id}}' 2>/dev/null)
echo "  интерфейс: ${BR:-не определился}"
if [ -n "$BR" ]; then
  ip link show "$BR" 2>/dev/null | sed 's/^/  /'
  HOST_MAC=$(ip link show "$BR" 2>/dev/null | awk '/link\/ether/{print $2}')
  echo "  MAC моста: ${HOST_MAC:-?}"
fi

for ct in $CTS; do
  line "Контейнер $ct"
  echo "  создан:  $(docker inspect "$ct" -f '{{.Created}}' 2>/dev/null)"
  echo "  запущен: $(docker inspect "$ct" -f '{{.State.StartedAt}}' 2>/dev/null)"

  echo "  таблица соседей (кого контейнер считает шлюзом):"
  # /proc/net/arp есть всегда, в отличие от утилиты ip.
  docker exec "$ct" sh -c 'cat /proc/net/arp' 2>/dev/null | sed 's/^/    /' \
    || echo "    не прочиталась"

  echo "  маршрут по умолчанию:"
  docker exec "$ct" sh -c "awk 'NR>1 && \$2==\"00000000\" {print \$1, \$3}' /proc/net/route" 2>/dev/null \
    | sed 's/^/    /' || echo "    не прочитался"

  echo "  TCP до $IP:443 — busybox, отдельно от TLS:"
  docker exec "$ct" sh -c "
    if command -v nc >/dev/null 2>&1; then
      start=\$(date +%s%N)
      if nc -w 5 -z $IP 443 2>/dev/null; then
        echo \"    nc: соединение установлено за \$(( (\$(date +%s%N) - start) / 1000000 )) мс\"
      else
        echo \"    nc: НЕ установлено за \$(( (\$(date +%s%N) - start) / 1000000 )) мс\"
      fi
    else
      echo '    nc в контейнере нет'
    fi
    if command -v wget >/dev/null 2>&1; then
      start=\$(date +%s%N)
      if wget -q -T 6 -O /dev/null https://api.telegram.org/ 2>/dev/null; then
        echo \"    wget: ответ получен за \$(( (\$(date +%s%N) - start) / 1000000 )) мс\"
      else
        echo \"    wget: ответа нет за \$(( (\$(date +%s%N) - start) / 1000000 )) мс (403 от Telegram тоже считается отказом wget)\"
      fi
    else
      echo '    wget в контейнере нет'
    fi
  " 2>/dev/null || echo "    команды не выполнились"
done

line "Нагрузка на контейнеры"
docker stats --no-stream --format '  {{.Name}}  CPU {{.CPUPerc}}  память {{.MemUsage}}' 2>/dev/null

line "Записей в таблице соединений"
if [ -r /proc/sys/net/netfilter/nf_conntrack_count ]; then
  echo "  сейчас:   $(cat /proc/sys/net/netfilter/nf_conntrack_count)"
  echo "  максимум: $(cat /proc/sys/net/netfilter/nf_conntrack_max)"
else
  echo "  счётчик недоступен"
fi

echo
echo "Проверка закончена. Ничего не изменено."
