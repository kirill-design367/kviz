#!/usr/bin/env bash
# AUREA · сквозная проверка квиза на cenasaita.ru.
#
# Только чтение: ни один файл, контейнер и конфиг не меняются. Единственное
# исключение — режим «lead», который сознательно отправляет одну заявку
# с пометкой ПРОВЕРКА, и включается он только явным аргументом.
#
# Проверка идёт ПО ПУБЛИЧНОМУ ПУТИ: адрес берётся из DNS домена, и запрос
# проходит ровно там же, где пойдёт посетитель — через хостовые правила,
# через nginx, через контейнер. Ходить curl'ом напрямую в контейнер было бы
# самообманом: так не видно ни сертификата, ни проксирования, ни редиректов.
#
# Запуск:
#   bash verify.sh          — проверка (ничего не отправляется)
#   bash verify.sh lead     — то же плюс одна тестовая заявка в Telegram
set -uo pipefail

DOMAIN="${AUREA_KVIZ_DOMAIN:-cenasaita.ru}"
MAIN="${AUREA_MAIN_DOMAIN:-aureadesign.ru}"
CT="${AUREA_KVIZ_CONTAINER:-aurea-kviz}"
SEND_LEAD="${1:-}"

ok=0; bad=0
say()  { printf '\n\033[1m── %s ─────────────────────────\033[0m\n' "$1"; }
good() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; bad=$((bad+1)); }
note() { printf '    %s\n' "$1"; }

# Адрес домена берём из DNS: именно он у посетителя. --resolve потом
# заставляет curl пойти туда же, минуя /etc/hosts и прочие местные хитрости.
IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
[ -n "$IP" ] || IP=$(getent ahostsv4 "$MAIN" 2>/dev/null | awk 'NR==1{print $1}')
RES=(--resolve "$DOMAIN:443:$IP" --resolve "$DOMAIN:80:$IP"
     --resolve "www.$DOMAIN:443:$IP" --resolve "www.$DOMAIN:80:$IP")
CURL=(curl -sS --max-time 15 "${RES[@]}")

# Локальный прогон: адрес приёмника задан напрямую, без DNS, TLS и nginx.
# Нужен, чтобы прогнать те же проверки страницы и приёмника на сборке
# до того, как что-то трогается на сервере. Разделы про переходы
# и сертификат в этом режиме пропускаются — проверять там нечего.
ORIGIN="https://$DOMAIN"
LOCAL=no
if [ -n "${AUREA_KVIZ_ORIGIN:-}" ]; then
  ORIGIN="${AUREA_KVIZ_ORIGIN%/}"
  LOCAL=yes
  CURL=(curl -sS --max-time 15)
fi

echo "AUREA · сквозная проверка · $(date -Is 2>/dev/null || date)"
if [ "$LOCAL" = yes ]; then
  echo "Локальный прогон по адресу: $ORIGIN (переходы и сертификат не проверяются)"
else
  echo "Домен: $DOMAIN   адрес из DNS: ${IP:-не определился}"
fi

# ── 1. Основной сайт: он проверяется ПЕРВЫМ ────────────────────────────────
# Если что-то сломано, знать об этом надо до всего остального.
if [ "$LOCAL" = no ]; then
say "Основной сайт $MAIN"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$MAIN/" 2>/dev/null)
[ "$code" = "200" ] && good "$MAIN отвечает 200" || fail "$MAIN отвечает $code"
days=$(echo | openssl s_client -servername "$MAIN" -connect "$MAIN:443" 2>/dev/null \
       | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
[ -n "$days" ] && note "сертификат основного сайта действует до: $days"
fi

# ── 2. Контейнер квиза ─────────────────────────────────────────────────────
if [ "$LOCAL" = no ]; then
say "Контейнер квиза"
state=$(docker inspect "$CT" -f '{{.State.Status}}' 2>/dev/null)
health=$(docker inspect "$CT" -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}без проверки{{end}}' 2>/dev/null)
img=$(docker inspect "$CT" -f '{{.Config.Image}}' 2>/dev/null)
if [ "$state" = running ]; then good "запущен, здоровье: $health"; else fail "состояние: ${state:-нет контейнера}"; fi
note "образ: ${img:-?}"
note "перезапусков: $(docker inspect "$CT" -f '{{.RestartCount}}' 2>/dev/null)"
fi

# ── 3. Переходы: каждый в ОДИН шаг ─────────────────────────────────────────
if [ "$LOCAL" = no ]; then
say "Переходы"
check_redirect() {
  local from="$1" want="$2"
  local out; out=$("${CURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' -k "$from" 2>/dev/null)
  local code="${out%% *}" to="${out#* }"
  if [ "$code" = "301" ] && [ "$to" = "$want" ]; then
    good "$from → $to (один шаг, 301)"
  else
    fail "$from → $code $to (ждали 301 → $want)"
  fi
}
check_redirect "http://$DOMAIN/"      "$ORIGIN/"
check_redirect "http://www.$DOMAIN/"  "$ORIGIN/"
check_redirect "https://www.$DOMAIN/" "$ORIGIN/"

# ── 4. Сертификат ──────────────────────────────────────────────────────────
say "Сертификат $DOMAIN"
cert=$(echo | openssl s_client -servername "$DOMAIN" -connect "$IP:443" 2>/dev/null)
subject=$(echo "$cert" | openssl x509 -noout -subject 2>/dev/null)
san=$(echo "$cert" | openssl x509 -noout -ext subjectAltName 2>/dev/null | tail -1 | tr -d ' ')
enddate=$(echo "$cert" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
issuer=$(echo "$cert" | openssl x509 -noout -issuer 2>/dev/null | sed 's/.*CN *= *//')
if echo "$san" | grep -q "DNS:$DOMAIN" && echo "$san" | grep -q "DNS:www.$DOMAIN"; then
  good "покрывает $DOMAIN и www.$DOMAIN"
else
  fail "в сертификате не оба имени: $san"
fi
note "издатель: ${issuer:-?}"
note "действует до: ${enddate:-?}"
note "${subject:-?}"
# Продление: тот же certbot, тот же webroot. Блок :80 обязан отдавать проверку.
acme=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "http://$DOMAIN/.well-known/acme-challenge/проверка-которой-нет" 2>/dev/null)
if [ "$acme" = "404" ]; then
  good "путь продления открыт: /.well-known/acme-challenge отдаёт 404, а не редирект"
else
  fail "/.well-known/acme-challenge отвечает $acme — продление сертификата не пройдёт"
fi
fi

# ── 5. Сама страница ───────────────────────────────────────────────────────
say "Страница"
html=$("${CURL[@]}" -D /tmp/aurea-h.$$ "$ORIGIN/" 2>/dev/null)
code=$(awk 'NR==1{print $2}' /tmp/aurea-h.$$ 2>/dev/null)
[ "$code" = "200" ] && good "$ORIGIN/ отвечает 200" || fail "$ORIGIN/ отвечает ${code:-нет ответа}"
# В разметке заголовок набран обычным регистром: прописные делает CSS,
# потому что Anticva юникейсная. Поэтому ищем без учёта регистра.
echo "$html" | grep -qi 'Узнайте стоимость' && good "заголовок первого экрана на месте" || fail "заголовка «Узнайте стоимость» в ответе нет"
if echo "$html" | grep -qi 'вашего сайта' && echo "$html" | grep -qi 'за минуту' \
   && echo "$html" | grep -q 'heading-lines'; then
  good "заголовок разбит на три заданные строки разметкой"
else
  fail "разбивки заголовка на три строки в разметке нет"
fi
# Префикса /kviz быть не должно: домен свой, сборка идёт без basePath.
if echo "$html" | grep -q '"/kviz/'; then
  fail "в разметке остался префикс /kviz — собрано не для своего домена"
else
  good "префикса /kviz нет: адреса ведут в корень домена"
fi
grep -qi '^cache-control:.*no-cache' /tmp/aurea-h.$$ && good "у HTML заголовок no-cache" || fail "у HTML нет no-cache: после выкладки покажется старая страница"
enc=$("${CURL[@]}" -o /dev/null -D - -H 'Accept-Encoding: gzip' "$ORIGIN/" 2>/dev/null | grep -i '^content-encoding:' | tr -d '\r')
[ -n "$enc" ] && good "сжатие работает: $enc" || fail "ответ не сжат — заголовок клиента до приёмника не дошёл"
rm -f /tmp/aurea-h.$$

# ── 6. Статика: хешированный файл и шрифт ──────────────────────────────────
say "Статика"
asset=$(echo "$html" | grep -o '/_next/static/[^"]*\.\(js\|css\)' | head -1)
if [ -n "$asset" ]; then
  h=$("${CURL[@]}" -o /dev/null -D - -H 'Accept-Encoding: gzip' "$ORIGIN$asset" 2>/dev/null | tr -d '\r')
  echo "$h" | head -1 | grep -q ' 200' && good "файл сборки отдаётся: $asset" || fail "файл сборки не отдался: $asset"
  echo "$h" | grep -qi 'cache-control:.*immutable' && good "кеш на год у хешированного имени" || fail "у $asset нет immutable"
  echo "$h" | grep -qi '^content-encoding: gzip' && good "файл сборки приходит сжатым" || fail "файл сборки не сжат"
else
  fail "в разметке не нашлось ни одного файла /_next/static"
fi
font=$(echo "$html" | grep -o '/fonts/[^"]*\.woff2' | head -1)
if [ -n "$font" ]; then
  h=$("${CURL[@]}" -o /dev/null -D - "$ORIGIN$font" 2>/dev/null | tr -d '\r')
  echo "$h" | head -1 | grep -q ' 200' && good "шрифт доезжает: $font" || fail "шрифт не отдался: $font"
  echo "$h" | grep -qi 'cache-control:.*immutable' && good "у шрифта кеш на год" || fail "у шрифта нет immutable"
else
  note "ссылок на шрифты в разметке нет — они объявлены в CSS, это нормально"
  h=$("${CURL[@]}" -o /dev/null -D - "$ORIGIN/fonts/onest.woff2" 2>/dev/null | tr -d '\r')
  echo "$h" | head -1 | grep -q ' 200' && good "шрифт /fonts/onest.woff2 отдаётся" || note "проверьте имена файлов в public/fonts"
fi

# ── 7. Своя страница 404 ───────────────────────────────────────────────────
say "Страница 404"
out=$("${CURL[@]}" -w '\n%{http_code}' "$ORIGIN/такой-страницы-нет/" 2>/dev/null)
code=$(echo "$out" | tail -1)
[ "$code" = "404" ] && good "несуществующий адрес отвечает 404" || fail "несуществующий адрес отвечает $code"
echo "$out" | grep -q 'AUREA' && good "404 — своя страница, а не текст сервера" || fail "404 отдаёт не нашу страницу"

# ── 8. Приёмник заявок ─────────────────────────────────────────────────────
say "Приёмник"
health_json=$("${CURL[@]}" "$ORIGIN/api/health" 2>/dev/null)
echo "$health_json" | grep -q '"ok": *true' && good "/api/health отвечает" || fail "/api/health не ответил: $health_json"
note "$health_json"
echo "$health_json" | grep -q '"configured": *true' && good "токен и чат заданы" || fail "токен или чат не заданы — заявки будут копиться на диске"
tgpath=$(echo "$health_json" | sed -n 's/.*"telegram_path": *"\([^"]*\)".*/\1/p')
case "$tgpath" in
  IPv6|IPv4) good "путь до Telegram выбран: $tgpath" ;;
  *) fail "путь до Telegram: ${tgpath:-?} — проба не прошла" ;;
esac
pending=$(echo "$health_json" | sed -n 's/.*"pending": *\([0-9]*\).*/\1/p')
[ "${pending:-0}" = "0" ] && good "неотправленных заявок нет" || fail "в очереди лежит ${pending} заявок"

# Живость без создания заявки: пустое тело обязано получить 422 с разбором
# полей. Так видно, что запрос дошёл до кода, а не остановился на nginx.
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{}' "$ORIGIN/api/lead" 2>/dev/null)
[ "$code" = "422" ] && good "POST /api/lead отвечает 422 на пустую заявку (проверка полей работает)" \
  || fail "POST /api/lead ответил $code, ожидали 422"

# ── 9. Тестовая заявка — только по явной команде ───────────────────────────
if [ "$SEND_LEAD" = "lead" ]; then
  say "Тестовая заявка"
  body='{"name":"Проверка связи","channel":"telegram","telegram":"@proverka","answers":[{"question":"Это тестовая заявка","answer":"Отправлена скриптом проверки, отвечать не нужно"}],"price":{"low":45000,"high":60000},"source":{"page":"проверка после переезда"}}'
  out=$("${CURL[@]}" -X POST -H 'Content-Type: application/json' -d "$body" "$ORIGIN/api/lead" 2>/dev/null)
  echo "$out" | grep -q '"ok": *true' && good "заявка принята: $out" || fail "заявка не принята: $out"
  note "смотрите Telegram: сообщение помечено как заявка с квиза"
  sleep 4
  note "очередь после отправки: $("${CURL[@]}" "$ORIGIN/api/health" 2>/dev/null | sed -n 's/.*"pending": *\([0-9]*\).*/\1/p')"
else
  note "тестовая заявка не отправлялась. Нужна — запустите: bash verify.sh lead"
fi

# ── 10. Основной сайт ещё раз, последним ───────────────────────────────────
if [ "$LOCAL" = no ]; then
say "Основной сайт после всех проверок"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$MAIN/" 2>/dev/null)
[ "$code" = "200" ] && good "$MAIN по-прежнему отвечает 200" || fail "$MAIN отвечает $code"
fi

say "Итог"
printf '  прошло: %d, не прошло: %d\n' "$ok" "$bad"
[ "$bad" = 0 ] && echo "  Всё в порядке." || echo "  Есть замечания — они помечены ✗ выше."
echo "  Ничего не изменено."
