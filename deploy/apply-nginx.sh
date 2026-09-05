#!/usr/bin/env bash
# AUREA · безопасная правка общего конфига nginx.
#
# Основной сайт aureadesign.ru неприкосновенен, поэтому порядок жёсткий:
#
#   1. копия файла с меткой времени;
#   2. блок квиза вырезается по маркерам и вставляется заново — чужие строки
#      не редактируются в принципе;
#   3. ДОКАЗАТЕЛЬСТВО: из старого и нового файла вырезается блок квиза,
#      остатки сравниваются. Любое расхождение — значит задето чужое,
#      и скрипт выходит, ничего не применив;
#   4. nginx -t ВНУТРИ контейнера;
#   5. при любой ошибке — возврат копии и НИКАКОГО reload;
#   6. reload только после успешной проверки;
#   7. в конце проверяется, что aureadesign.ru отвечает 200. Не отвечает —
#      копия возвращается, nginx перечитывается обратно.
#
# Запуск:
#   bash apply-nginx.sh http    — блок без TLS (до выпуска сертификата)
#   bash apply-nginx.sh https   — блок с TLS (после выпуска)
#   bash apply-nginx.sh remove  — снять блок квиза совсем
set -uo pipefail

MODE="${1:-}"
STACK="${AUREA_STACK_DIR:-/opt/aurea/studio}"
NGINX_CT="${AUREA_NGINX_CONTAINER:-aurea-nginx}"
RAW="https://raw.githubusercontent.com/kirill-design367/kviz/claude/aurea-quiz-landing-1i0c4o/deploy"
BEGIN='# >>> AUREA-KVIZ'
END='# <<< AUREA-KVIZ'

say()  { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }
die()  { printf '\033[31mОШИБКА: %s\033[0m\n' "$1"; exit 1; }

case "$MODE" in
  http|https|remove) ;;
  *) die "укажите режим: http, https или remove" ;;
esac

cd "$STACK" || die "нет каталога $STACK"

# Значение ключа из .env: без пробелов вокруг, без кавычек, без \r.
# Пробел в конце строки не виден глазом, но ломает всё: путь с ним
# не существует, и скрипт падал на ровном месте. .env при этом не трогаем —
# чинить надо чтение, а не чужой файл.
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" .env 2>/dev/null \
    | head -1 \
    | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

say "Файл конфигурации"
FROM_ENV=$(env_value NGINX_CONF)
echo "  NGINX_CONF из .env: ${FROM_ENV:-не задан}"

# Монтирование фиксируется в момент СОЗДАНИЯ контейнера, поэтому источник
# правды — то, что реально проброшено, а не то, что сегодня написано в .env.
# Если переменную меняли после запуска nginx, внутрь проброшен старый файл,
# и правки уходили бы туда, куда nginx не смотрит.
MOUNTED=$(docker inspect "$NGINX_CT" \
  -f '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d/default.conf"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
echo "  реально проброшен в контейнер: ${MOUNTED:-не определился}"

if [ -n "$MOUNTED" ] && [ -f "$MOUNTED" ]; then
  CONF="$MOUNTED"
elif [ -n "$FROM_ENV" ] && [ -f "$FROM_ENV" ]; then
  CONF="$FROM_ENV"
else
  CONF="./deploy/nginx.https.conf"
fi
[ -f "$CONF" ] || die "не нашёл файл конфигурации: ни проброшенный, ни '$FROM_ENV', ни ./deploy/nginx.https.conf"

if [ -n "$MOUNTED" ] && [ -n "$FROM_ENV" ] \
   && [ "$(readlink -f "$FROM_ENV" 2>/dev/null)" != "$(readlink -f "$MOUNTED" 2>/dev/null)" ]; then
  echo "  ВНИМАНИЕ: .env и контейнер указывают на РАЗНЫЕ файлы."
  echo "  Правлю тот, что реально проброшен — только его видит nginx."
fi
echo "  правим: $CONF"
echo "  блоков server: $(grep -c '^server[[:space:]]*{' "$CONF")"
echo "  упоминаний aureadesign: $(grep -c aureadesign "$CONF")"
echo "  упоминаний cenasaita:   $(grep -c cenasaita "$CONF")"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$CONF.before-kviz-$STAMP"
cp -a "$CONF" "$BACKUP" || die "не смог сделать копию"
say "Копия"
echo "  $BACKUP"

# --- собираем новое содержимое --------------------------------------------- #
strip_block() {
  awk -v b="$BEGIN" -v e="$END" '
    index($0, b) == 1 { skip = 1 }
    skip != 1 { print }
    index($0, e) == 1 { skip = 0 }
  ' "$1"
}

NEW=$(mktemp)
strip_block "$CONF" > "$NEW"

if [ "$MODE" != remove ]; then
  BLOCK=$(mktemp)
  SRC="$RAW/nginx.cenasaita.$MODE.conf"
  if ! curl -fsSL "$SRC" -o "$BLOCK"; then
    rm -f "$NEW" "$BLOCK"
    die "не скачался блок $SRC"
  fi
  grep -q "^$BEGIN" "$BLOCK" || { rm -f "$NEW" "$BLOCK"; die "в скачанном блоке нет маркера — не применяю"; }
  grep -q 'cenasaita.ru' "$BLOCK" || { rm -f "$NEW" "$BLOCK"; die "в скачанном блоке нет домена — не применяю"; }
  printf '\n' >> "$NEW"
  cat "$BLOCK" >> "$NEW"
  rm -f "$BLOCK"
fi

# --- доказательство, что чужое не задето ------------------------------------ #
say "Проверка: чужие строки не тронуты"
# Хвостовые пустые строки не считаем расхождением: блок отделяется
# от чужого текста пустой строкой, и без этого первое же применение
# выглядело бы как правка чужого файла.
drop_tail_blanks() {
  awk '{ l[NR] = $0 }
       END { n = NR; while (n > 0 && l[n] ~ /^[[:space:]]*$/) n--;
             for (i = 1; i <= n; i++) print l[i] }'
}

A=$(mktemp); B=$(mktemp)
strip_block "$BACKUP" | drop_tail_blanks > "$A"
strip_block "$NEW"    | drop_tail_blanks > "$B"
if diff -q "$A" "$B" >/dev/null; then
  echo "  всё, кроме блока квиза, совпадает байт в байт"
else
  echo "  РАСХОЖДЕНИЕ вне блока квиза:"
  diff -u "$A" "$B" | head -40
  rm -f "$A" "$B" "$NEW"
  die "затронуто чужое — ничего не применяю"
fi
rm -f "$A" "$B"

# Инод сохраняем: файл проброшен в контейнер как файл, и подмена инода
# оборвала бы связь с контейнером.
cat "$NEW" > "$CONF"
rm -f "$NEW"

restore() {
  cat "$BACKUP" > "$CONF"
  echo "  копия возвращена"
}

# --- проверка конфигурации внутри контейнера -------------------------------- #
say "nginx -t внутри контейнера"
if ! docker exec "$NGINX_CT" nginx -t 2>&1 | sed 's/^/  /'; then
  restore
  die "проверка не прошла — reload НЕ делался, файл возвращён"
fi

say "Перечитывание"
if ! docker exec "$NGINX_CT" nginx -s reload 2>&1 | sed 's/^/  /'; then
  restore
  docker exec "$NGINX_CT" nginx -s reload >/dev/null 2>&1
  die "reload не удался — файл возвращён"
fi
echo "  перечитан"
sleep 1

# --- что на самом деле загружено -------------------------------------------- #
say "Что видит nginx в рабочей конфигурации"
docker exec "$NGINX_CT" nginx -T 2>/dev/null \
  | grep -nE 'server_name|# configuration file' | sed 's/^/  /'

# --- главное: жив ли основной сайт ------------------------------------------ #
say "Основной сайт"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: aureadesign.ru' https://127.0.0.1/ --insecure)
echo "  aureadesign.ru: HTTP $CODE"
if [ "$CODE" != "200" ]; then
  echo "  НЕ 200 — возвращаю копию и перечитываю обратно"
  restore
  docker exec "$NGINX_CT" nginx -t >/dev/null 2>&1 && docker exec "$NGINX_CT" nginx -s reload >/dev/null 2>&1
  CODE2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: aureadesign.ru' https://127.0.0.1/ --insecure)
  echo "  после возврата: HTTP $CODE2"
  die "основной сайт ответил не 200 — изменения откачены"
fi

say "Квиз"
curl -s -o /dev/null -w '  http://cenasaita.ru      → %{http_code} %{redirect_url}\n' --max-time 10 -H 'Host: cenasaita.ru' http://127.0.0.1/
curl -s -o /dev/null -w '  http://www.cenasaita.ru  → %{http_code} %{redirect_url}\n' --max-time 10 -H 'Host: www.cenasaita.ru' http://127.0.0.1/
if [ "$MODE" = https ]; then
  curl -s -o /dev/null -w '  https://cenasaita.ru     → %{http_code}\n' --max-time 10 -H 'Host: cenasaita.ru' https://127.0.0.1/ --insecure
  curl -s -o /dev/null -w '  https://www.cenasaita.ru → %{http_code} %{redirect_url}\n' --max-time 10 -H 'Host: www.cenasaita.ru' https://127.0.0.1/ --insecure
fi

say "Готово"
echo "  режим: $MODE"
echo "  копия: $BACKUP"
echo "  откат вручную: cat $BACKUP > $CONF && docker exec $NGINX_CT nginx -s reload"
