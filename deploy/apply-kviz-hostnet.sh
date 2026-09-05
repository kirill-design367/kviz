#!/usr/bin/env bash
# AUREA · перевод контейнера квиза в сеть хоста.
#
# ЗАЧЕМ. Из docker-сети исходящий путь наружу закрыт: TCP до Telegram умирает
# по таймауту из ЛЮБОГО контейнера этой сети, а с самого хоста тот же адрес
# отвечает за 44 мс. Чинится это правилами хоста, общими для всей сети, —
# то есть задело бы и основной сайт. Поэтому чиним только своё: контейнер
# квиза переезжает в сеть хоста, где путь рабочий.
#
# ЧТО МЕНЯЕТСЯ.
#   1. В docker-compose.yml — ТОЛЬКО блок сервиса kviz. Ни web, ни nginx,
#      ни certbot, ни volumes, ни networks не редактируются. Это доказывается:
#      из старого и нового файла вырезается блок kviz, остатки сравниваются
#      байт в байт, и при любом расхождении скрипт выходит, ничего не применив.
#   2. Пересоздаётся один контейнер aurea-kviz. Соседи не перезапускаются.
#   3. В конфиге nginx — только блок квиза: proxy_pass переезжает с имени
#      контейнера на адрес моста. Правит его apply-nginx.sh, у которого своя
#      копия, своя проверка и свой откат.
#
# ЧТО БУДЕТ С ОСНОВНЫМ САЙТОМ. Ничего. Его контейнер и его сеть не тронуты,
# nginx перечитывается тем же способом, что и всегда, без остановки. В конце
# скрипт сам проверяет, что aureadesign.ru отвечает 200; не отвечает — откат.
#
# ЦЕНА РЕШЕНИЯ, чтобы она была названа заранее: контейнер в сети хоста может
# занимать порты хоста. Поэтому приёмник слушает НЕ 0.0.0.0, а один адрес
# моста (172.18.0.1:8787): снаружи его не видно, изнутри docker-сети — видно.
#
# Запуск:  bash apply-kviz-hostnet.sh
set -uo pipefail

STACK="${AUREA_STACK_DIR:-/opt/aurea/studio}"
NGINX_CT="${AUREA_NGINX_CONTAINER:-aurea-nginx}"
CT="${AUREA_KVIZ_CONTAINER:-aurea-kviz}"
NET="${AUREA_NET:-studio_default}"
PORT="${AUREA_KVIZ_PORT:-8787}"
RAW="${AUREA_RAW:-https://raw.githubusercontent.com/kirill-design367/kviz/claude/aurea-quiz-landing-1i0c4o/deploy}"

say() { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }
die() { printf '\033[31mОШИБКА: %s\033[0m\n' "$1"; exit 1; }

cd "$STACK" || die "нет каталога $STACK"
COMPOSE=docker-compose.yml
[ -f "$COMPOSE" ] || COMPOSE=compose.yaml
[ -f "$COMPOSE" ] || die "не нашёл docker-compose.yml"

# --- 1. Можно ли вообще занять этот адрес ----------------------------------- #
say "Проверка до правок"
GW=$(docker network inspect "$NET" -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null)
[ -n "$GW" ] || die "не определился шлюз сети $NET"
echo "  шлюз сети $NET: $GW"
ip -4 addr show 2>/dev/null | grep -q "inet $GW/" \
  || die "адреса $GW нет ни на одном интерфейсе хоста — переезжать некуда"
echo "  адрес $GW на хосте есть"

if ss -tlnH 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p' | grep -q .; then
  ss -tlnp 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p' | sed 's/^/    /'
  die "порт $PORT на хосте занят — сначала разберитесь, кем"
fi
echo "  порт $PORT на хосте свободен"

if [ "$GW" != "172.18.0.1" ]; then
  echo "  ВНИМАНИЕ: в блоке nginx и в сервисе прописан 172.18.0.1, а шлюз $GW."
  echo "  Запустите с KVIZ_BIND=$GW и поправьте адрес в блоке nginx."
fi

# --- Тот ли образ ----------------------------------------------------------- #
# В сети хоста служба слушает адрес моста, а не 0.0.0.0, и встроенная проверка
# здоровья обязана стучаться туда же. В старых образах она прибита к 127.0.0.1:
# на них контейнер поднялся бы рабочим, но был бы помечен больным — и этот же
# скрипт откатил бы всё назад. Поэтому образ проверяется ДО правок.
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" .env 2>/dev/null \
    | head -1 | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
LATEST="ghcr.io/kirill-design367/aurea-kviz:latest"
IMG=$(env_value KVIZ_IMAGE); [ -n "$IMG" ] || IMG="$LATEST"
echo "  образ из .env: $IMG"

healthcheck_ok() {
  docker image inspect "$1" -f '{{json .Config.Healthcheck.Test}}' 2>/dev/null \
    | grep -q 'AUREA_KVIZ_BIND'
}

docker pull -q "$IMG" >/dev/null 2>&1
if healthcheck_ok "$IMG"; then
  echo "  проверка здоровья в образе следует за адресом привязки — годится"
else
  echo "  в этом образе проверка здоровья прибита к 127.0.0.1 — беру :latest"
  docker pull -q "$LATEST" >/dev/null 2>&1
  if ! healthcheck_ok "$LATEST"; then
    die "нужного образа ещё нет в реестре. Подождите, пока соберётся сборка, и запустите снова — сейчас ничего не изменено"
  fi
  # Ключ KVIZ_IMAGE в .env вы разрешали. Следующая выкладка перепишет его
  # на конкретный тег коммита, в котором эта правка уже есть.
  if grep -q '^[[:space:]]*KVIZ_IMAGE[[:space:]]*=' .env 2>/dev/null; then
    tmp=$(mktemp)
    grep -v '^[[:space:]]*KVIZ_IMAGE[[:space:]]*=' .env > "$tmp"
    printf 'KVIZ_IMAGE=%s\n' "$LATEST" >> "$tmp"
    cat "$tmp" > .env
    rm -f "$tmp"
  else
    printf 'KVIZ_IMAGE=%s\n' "$LATEST" >> .env
  fi
  echo "  KVIZ_IMAGE переставлен на :latest"
fi

# --- 2. Копия и замена одного блока ----------------------------------------- #
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$COMPOSE.before-kviz-hostnet-$STAMP"
cp -a "$COMPOSE" "$BACKUP" || die "не смог сделать копию"
say "Копия"
echo "  $BACKUP"

# Вырезаем сервис kviz целиком: от строки «  kviz:» до следующего ключа того же
# или меньшего уровня. Прилипшие сверху комментарии — часть нашего блока,
# поэтому они копятся в буфере и выбрасываются вместе с ним. Любой чужой
# сервис при этом остаётся на месте: условие входа — именно имя kviz.
strip_kviz() {
  awk '
    BEGIN { inblock = 0; np = 0 }
    inblock == 1 {
      if ($0 ~ /^[^[:space:]]/ || $0 ~ /^  [A-Za-z0-9_.-]+:/) { inblock = 0 }
      else next
    }
    $0 ~ /^  kviz:[[:space:]]*$/ { inblock = 1; np = 0; next }
    $0 ~ /^[[:space:]]*#/ || $0 ~ /^[[:space:]]*$/ { pend[np++] = $0; next }
    { for (i = 0; i < np; i++) print pend[i]; np = 0; print }
    END { for (i = 0; i < np; i++) print pend[i] }
  ' "$1"
}

grep -q '^  kviz:' "$COMPOSE" || die "в $COMPOSE нет сервиса kviz — нечего переносить"

FRAG=$(mktemp)
if ! curl -fsSL "$RAW/compose.kviz.yml" -o "$FRAG"; then
  rm -f "$FRAG"; die "не скачался фрагмент $RAW/compose.kviz.yml"
fi
grep -q 'network_mode: host' "$FRAG" || { rm -f "$FRAG"; die "в скачанном фрагменте нет сети хоста — не применяю"; }
grep -q '^  kviz:' "$FRAG" || { rm -f "$FRAG"; die "в скачанном фрагменте нет сервиса kviz — не применяю"; }

NEW=$(mktemp)
# Новый файл: всё без блока kviz, а сам блок вставляется туда же, где стоял, —
# перед строкой volumes: верхнего уровня, как и при первой установке.
awk -v frag="$FRAG" '
  BEGIN { while ((getline l < frag) > 0) block[n++] = l }
  /^volumes:/ && !done { for (i = 0; i < n; i++) print block[i]; print ""; done = 1 }
  { print }
  END { if (!done) for (i = 0; i < n; i++) print block[i] }
' <(strip_kviz "$COMPOSE") > "$NEW"
rm -f "$FRAG"

# --- 3. Доказательство: чужое не задето ------------------------------------- #
say "Проверка: чужие сервисы не тронуты"
drop_tail_blanks() {
  awk '{ l[NR] = $0 }
       END { n = NR; while (n > 0 && l[n] ~ /^[[:space:]]*$/) n--;
             for (i = 1; i <= n; i++) print l[i] }'
}
A=$(mktemp); B=$(mktemp)
strip_kviz "$BACKUP" | drop_tail_blanks > "$A"
strip_kviz "$NEW"    | drop_tail_blanks > "$B"
if diff -q "$A" "$B" >/dev/null; then
  echo "  всё, кроме сервиса kviz, совпадает байт в байт"
else
  echo "  РАСХОЖДЕНИЕ вне сервиса kviz:"
  diff -u "$A" "$B" | head -40
  rm -f "$A" "$B" "$NEW"
  die "затронуто чужое — ничего не применяю"
fi
rm -f "$A" "$B"

cat "$NEW" > "$COMPOSE"
rm -f "$NEW"

restore_compose() {
  cat "$BACKUP" > "$COMPOSE"
  echo "  compose возвращён из копии"
  docker compose up -d kviz >/dev/null 2>&1
}

# Валидация БЕЗ печати: «docker compose config» подставляет значения из .env
# в вывод, и токен уехал бы в переписку. Ключ -q печатает только ошибки.
say "Проверка синтаксиса compose"
if ! docker compose config -q 2>&1 | sed 's/^/  /'; then
  restore_compose
  die "compose не принял файл — вернул копию"
fi
echo "  принят"

# --- 4. Пересоздаём один контейнер ------------------------------------------ #
say "Пересоздание контейнера квиза"
docker compose up -d kviz 2>&1 | sed 's/^/  /'

ok=no
for i in $(seq 1 30); do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}нет проверки{{end}}' "$CT" 2>/dev/null || echo unknown)
  [ "$state" = healthy ] && { ok=yes; break; }
  sleep 2
done
echo "  здоровье: ${state:-неизвестно}"

BIND="${KVIZ_BIND:-$GW}"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$BIND:$PORT/api/health")
echo "  приёмник на $BIND:$PORT отвечает: HTTP $CODE"
if [ "$ok" != yes ] || [ "$CODE" != "200" ]; then
  echo "  не поднялся — откатываю compose. Конфиг nginx при этом НЕ трогался."
  docker logs --tail 30 "$CT" 2>&1 | sed 's/^/    /'
  restore_compose
  die "контейнер не встал в сети хоста — вернул как было"
fi

# --- 5. Теперь блок nginx --------------------------------------------------- #
say "Блок nginx: адрес вместо имени"
if ! curl -fsSL "$RAW/apply-nginx.sh" -o /tmp/apply-nginx.sh; then
  die "не скачался apply-nginx.sh — контейнер уже в сети хоста, nginx ещё смотрит на имя"
fi
AUREA_RAW="$RAW" bash /tmp/apply-nginx.sh https || die "правка nginx не удалась (у неё свой откат)"

# --- 6. Что получилось ------------------------------------------------------ #
say "Итог"
echo "  основной сайт: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: aureadesign.ru' https://127.0.0.1/ --insecure)"
echo "  квиз:          HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: cenasaita.ru' https://127.0.0.1/ --insecure)"
echo "  здоровье приёмника:"
curl -s --max-time 10 "http://$BIND:$PORT/api/health" | sed 's/^/    /'
echo
echo "  Путь до Telegram проба ищет ещё несколько минут после старта."
echo "  Заявки из очереди уйдут сами, как только путь найдётся."
echo "  Копия compose: $BACKUP"
echo "  Откат вручную: cat $BACKUP > $STACK/$COMPOSE && docker compose up -d kviz"
