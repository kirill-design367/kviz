#!/usr/bin/env bash
# AUREA · nginx не достучался до приёмника после переезда в сеть хоста.
#
# ПОЧЕМУ ТАК ВЫШЛО. Пока контейнер стоял в мосту, запрос nginx → приёмник был
# разговором двух контейнеров: ядро проводило его через FORWRD, где правила
# Docker всё разрешают. После переезда приёмник слушает адрес самого хоста,
# и тот же запрос стал входящим НА ХОСТ — то есть пошёл через INPUT, где
# командует ufw с политикой «входящее запрещено». Порт 8787 там не открыт,
# пакет отбрасывается молча, и nginx ждёт ответа до своего таймаута.
#
# Отсюда и ровно та картина, что мы видим: :80 отвечает (там только переход),
# 443 у www отвечает (там тоже только переход), а 443 у самого домена висит —
# это единственный блок, который проксирует. Будь порт закрыт «отказом»,
# а не «молчанием», nginx вернул бы 502 мгновенно.
#
# ЧТО ДЕЛАЕТ СКРИПТ. Сначала читает: проверяет, доходит ли nginx до приёмника,
# что говорит его журнал и что разрешает ufw. Если доходит — значит причина
# другая, и скрипт выходит, ничего не меняя.
#
# Если не доходит, добавляется ОДНО правило, узкое настолько, насколько это
# возможно: принимать на адрес моста, на порт 8787, только по TCP и только
# от подсети docker-сети. Снаружи этот адрес не маршрутизируется, поэтому
# новая дверь наружу не открывается. Правил основного сайта скрипт не трогает
# и вторых правил не добавляет.
#
# Если после правила сайт не поднялся, скрипт сам снимает это правило
# и возвращает переезд назад по копиям: конфиг nginx и compose из бэкапов,
# контейнер обратно в мост. Квиз при этом снова заработает, а Telegram
# снова замолчит — и решать, что делать дальше, будете вы.
#
# Запуск:  bash fix-kviz-upstream.sh
set -uo pipefail

STACK="${AUREA_STACK_DIR:-/opt/aurea/studio}"
NGINX_CT="${AUREA_NGINX_CONTAINER:-aurea-nginx}"
CT="${AUREA_KVIZ_CONTAINER:-aurea-kviz}"
NET="${AUREA_NET:-studio_default}"
PORT="${AUREA_KVIZ_PORT:-8787}"

say() { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }
die() { printf '\033[31mОШИБКА: %s\033[0m\n' "$1"; exit 1; }

cd "$STACK" || die "нет каталога $STACK"
COMPOSE=docker-compose.yml; [ -f "$COMPOSE" ] || COMPOSE=compose.yaml

GW=$(docker network inspect "$NET" -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null)
SUBNET=$(docker network inspect "$NET" -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null)
[ -n "$GW" ] && [ -n "$SUBNET" ] || die "не определились шлюз и подсеть сети $NET"

quiz_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 12 -H 'Host: cenasaita.ru' https://127.0.0.1/ --insecure; }
main_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 12 -H 'Host: aureadesign.ru' https://127.0.0.1/ --insecure; }

# --- 1. Читаем ------------------------------------------------------------- #
say "Как обстоят дела"
echo "  сеть $NET: подсеть $SUBNET, шлюз $GW"
echo "  приёмник с хоста:        HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$GW:$PORT/api/health")"
echo "  квиз через nginx:        HTTP $(quiz_code)"
echo "  основной сайт:           HTTP $(main_code)"

say "Доходит ли nginx до приёмника"
FROM_NGINX=unknown
if docker exec "$NGINX_CT" sh -c 'command -v wget' >/dev/null 2>&1; then
  if docker exec "$NGINX_CT" wget -q -T 5 -O /dev/null "http://$GW:$PORT/api/health" 2>/dev/null; then
    FROM_NGINX=yes
  else
    FROM_NGINX=no
  fi
  echo "  проверял через wget внутри контейнера nginx: $([ "$FROM_NGINX" = yes ] && echo дошёл || echo НЕ дошёл)"
elif docker exec "$NGINX_CT" sh -c 'command -v nc' >/dev/null 2>&1; then
  if docker exec "$NGINX_CT" nc -z -w 5 "$GW" "$PORT" 2>/dev/null; then FROM_NGINX=yes; else FROM_NGINX=no; fi
  echo "  проверял через nc внутри контейнера nginx: $([ "$FROM_NGINX" = yes ] && echo дошёл || echo НЕ дошёл)"
else
  echo "  ни wget, ни nc в контейнере nginx нет — проверить изнутри нечем."
  echo "  Это не отказ связи, а отсутствие инструмента: сужу по журналу ниже."
fi

say "Журнал nginx: что он сам говорит про приёмник"
docker logs --tail 200 "$NGINX_CT" 2>&1 | grep -iE 'upstream|172\.18\.0\.1' | tail -5 | sed 's/^/  /' \
  || echo "  ничего про upstream не пишет"

say "Что разрешает ufw"
ufw status verbose 2>/dev/null | head -12 | sed 's/^/  /' || echo "  ufw не отвечает"
echo "  правила, где упоминается $PORT:"
ufw status 2>/dev/null | grep -F "$PORT" | sed 's/^/    /' || echo "    ни одного"

# --- 2. Решаем ------------------------------------------------------------- #
if [ "$FROM_NGINX" = yes ]; then
  say "Вывод"
  echo "  nginx до приёмника ДОХОДИТ, значит дело не в firewall."
  echo "  Ничего не меняю. Смотрите журнал nginx выше и ответ квиза: HTTP $(quiz_code)."
  exit 0
fi

say "Что будет добавлено"
RULE_ARGS=(allow from "$SUBNET" to "$GW" port "$PORT" proto tcp)
echo "  ufw ${RULE_ARGS[*]}"
echo
echo "  Это правило принимает соединения ТОЛЬКО на адрес моста $GW,"
echo "  ТОЛЬКО на порт $PORT, ТОЛЬКО по TCP и ТОЛЬКО из подсети $SUBNET."
echo "  Адрес $GW снаружи не маршрутизируется — новой двери из интернета нет."
echo "  Правил основного сайта скрипт не касается."
echo "  Снять потом: ufw delete ${RULE_ARGS[*]}"

command -v ufw >/dev/null 2>&1 || die "ufw на хосте нет, а входящее всё равно не проходит — дальше руками"

say "Добавляю правило"
if ! ufw "${RULE_ARGS[@]}" comment 'AUREA kviz: nginx -> приёмник' 2>&1 | sed 's/^/  /'; then
  # Старые ufw не понимают comment — пробуем без него.
  ufw "${RULE_ARGS[@]}" 2>&1 | sed 's/^/  /' || die "правило не добавилось"
fi

# --- 3. Проверяем ---------------------------------------------------------- #
say "Проверка"
sleep 2
QUIZ=$(quiz_code); MAIN=$(main_code)
echo "  квиз через nginx: HTTP $QUIZ"
echo "  основной сайт:    HTTP $MAIN"

if [ "$QUIZ" = "200" ] && [ "$MAIN" = "200" ]; then
  say "Готово"
  echo "  Сайт поднялся, путь до Telegram остался рабочим."
  curl -s --max-time 10 "http://$GW:$PORT/api/health" | sed 's/^/  /'
  echo
  echo "  Снять правило, если понадобится: ufw delete ${RULE_ARGS[*]}"
  exit 0
fi

# --- 4. Не помогло — возвращаем всё как было ------------------------------- #
say "Не помогло — возвращаю переезд назад"
ufw delete "${RULE_ARGS[@]}" >/dev/null 2>&1 && echo "  добавленное правило снято"

CONF=$(docker inspect "$NGINX_CT" \
  -f '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d/default.conf"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
NG_BACKUP=$(ls -1t "$CONF".before-kviz-* 2>/dev/null | head -1)
if [ -n "$NG_BACKUP" ]; then
  cat "$NG_BACKUP" > "$CONF"
  echo "  конфиг nginx возвращён из $NG_BACKUP"
  docker exec "$NGINX_CT" nginx -t >/dev/null 2>&1 && docker exec "$NGINX_CT" nginx -s reload >/dev/null 2>&1 \
    && echo "  nginx перечитан"
else
  echo "  копии конфига nginx не нашлось — трогать его не стал"
fi

CP_BACKUP=$(ls -1t "$COMPOSE".before-kviz-hostnet-* 2>/dev/null | head -1)
if [ -n "$CP_BACKUP" ]; then
  cat "$CP_BACKUP" > "$COMPOSE"
  echo "  compose возвращён из $CP_BACKUP"
  docker compose up -d kviz 2>&1 | sed 's/^/    /'
else
  echo "  копии compose не нашлось — контейнер оставлен в сети хоста"
fi

sleep 5
say "После возврата"
echo "  квиз через nginx: HTTP $(quiz_code)"
echo "  основной сайт:    HTTP $(main_code)"
echo
echo "  Квиз снова в мосту: сайт работает, путь до Telegram снова закрыт."
echo "  Заявки при этом не теряются — они ложатся на диск и ждут в очереди."
exit 1
