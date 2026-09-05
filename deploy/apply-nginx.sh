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
# Откуда брать блоки. По умолчанию — ветка, но у raw.githubusercontent
# кеш на несколько минут, и сразу после правки оттуда может приехать
# вчерашний файл. Поэтому команды даются с адресом, прибитым к коммиту:
# AUREA_RAW=.../<sha>/deploy — такой адрес неизменен и не кешируется мимо.
RAW="${AUREA_RAW:-https://raw.githubusercontent.com/kirill-design367/kviz/claude/aurea-quiz-landing-1i0c4o/deploy}"
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
echo "  блоков квиза сейчас:    $(grep -c '^[[:space:]]*server_name[[:space:]].*cenasaita' "$CONF")"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$CONF.before-kviz-$STAMP"
cp -a "$CONF" "$BACKUP" || die "не смог сделать копию"
say "Копия"
echo "  $BACKUP"

# --- вырезание всего, что относится к квизу --------------------------------- #
#
# Убирается два вида следов:
#   1. область между маркерами AUREA-KVIZ — так блок кладётся сейчас;
#   2. любой блок server верхнего уровня, где упоминается cenasaita, вместе
#      с прилипшими к нему сверху комментариями. Это нужно для блока от первой
#      попытки: маркеров тогда ещё не было, и он остался в файле вторым
#      экземпляром — nginx ругался «conflicting server name ... ignored».
#
# Чужие блоки не трогаются: условие удаления — упоминание домена квиза.
# Скобки считаются, поэтому вложенные location и if внутри чужих блоков
# не сбивают разбор.
strip_block() {
  awk '
    BEGIN { depth = 0; inmark = 0; inserver = 0; np = 0; nb = 0 }
    { line = $0 }

    inmark == 1 {
      if (index(line, "# <<< AUREA-KVIZ") == 1) inmark = 0
      next
    }
    index(line, "# >>> AUREA-KVIZ") == 1 { inmark = 1; np = 0; next }

    inserver == 1 {
      buf[nb++] = line
      depth += gsub(/\{/, "{", line)
      depth -= gsub(/\}/, "}", line)
      if (depth <= 0) {
        body = ""
        for (i = 0; i < nb; i++) body = body buf[i] "\n"
        if (body !~ /cenasaita/) {
          for (i = 0; i < np; i++) print pend[i]
          printf "%s", body
        }
        np = 0; nb = 0; inserver = 0; depth = 0
      }
      next
    }

    depth == 0 && line ~ /^[[:space:]]*server[[:space:]]*\{/ {
      inserver = 1; nb = 0; buf[nb++] = line; depth = 1; next
    }

    line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/ { pend[np++] = line; next }

    { for (i = 0; i < np; i++) print pend[i]; np = 0; print line }

    END { for (i = 0; i < np; i++) print pend[i] }
  ' "$1"
}

NEW=$(mktemp)
strip_block "$CONF" > "$NEW"

# Какие куски кладём. В режиме https блок :80 остаётся на месте: он не только
# уводит с http на https, но и отдаёт /.well-known/acme-challenge — именно
# через него certbot продлевает сертификат. Убрать его вместе со старым блоком
# и не вернуть значило бы поставить бомбу с часовым механизмом на 60 дней.
case "$MODE" in
  http)  PARTS="http" ;;
  https) PARTS="http https" ;;
  *)     PARTS="" ;;
esac

if [ -n "$PARTS" ]; then
  for part in $PARTS; do
    BLOCK=$(mktemp)
    SRC="$RAW/nginx.cenasaita.$part.conf"
    if ! curl -fsSL "$SRC" -o "$BLOCK"; then
      rm -f "$NEW" "$BLOCK"
      die "не скачался блок $SRC"
    fi
    grep -q "^$BEGIN" "$BLOCK" || { rm -f "$NEW" "$BLOCK"; die "в блоке $part нет маркера — не применяю"; }
    grep -q 'cenasaita.ru' "$BLOCK" || { rm -f "$NEW" "$BLOCK"; die "в блоке $part нет домена — не применяю"; }
    printf '\n' >> "$NEW"
    cat "$BLOCK" >> "$NEW"
    rm -f "$BLOCK"
  done
fi

# --- доказательство, что чужое не задето ------------------------------------ #
say "Проверка: чужие строки не тронуты"
# Сравнивается всё, КРОМЕ блоков квиза, в старом файле и в новом. Совпало —
# значит ни одна чужая строка не изменилась. Не совпало — выходим, ничего
# не применив: расхождение вне нашего блока означает, что задето чужое.
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

# Без сертификата блок 443 не пройдёт nginx -t, и мы зря сходим до отката.
# Лучше сказать об этом до того, как файл будет переписан на боевом сервере.
if [ "$MODE" = https ]; then
  say "Сертификат cenasaita.ru"
  if docker exec "$NGINX_CT" test -f /etc/letsencrypt/live/cenasaita.ru/fullchain.pem 2>/dev/null; then
    echo "  на месте: /etc/letsencrypt/live/cenasaita.ru/fullchain.pem"
  else
    restore
    die "внутри nginx нет /etc/letsencrypt/live/cenasaita.ru/fullchain.pem — сначала выпустите сертификат"
  fi
fi

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
echo "  блоков квиза в файле: $(grep -c '^[[:space:]]*server_name[[:space:]].*cenasaita' "$CONF") (ожидается $([ "$MODE" = remove ] && echo 0 || { [ "$MODE" = https ] && echo 3 || echo 1; }))"
echo "  режим: $MODE"
echo "  копия: $BACKUP"
echo "  откат вручную: cat $BACKUP > $CONF && docker exec $NGINX_CT nginx -s reload"
