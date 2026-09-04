#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AUREA · установка приёмника заявок с квиз-лендинга.
#
# Запуск под root:   bash install.sh
# Повторный запуск безопасен: скрипт идемпотентен.
#
# Что делает:
#   1. осматривает сервер и печатает, что на нём стоит;
#   2. проверяет, не займёт ли он чужое (порт, имя юнита, конфиг nginx);
#   3. ставит сервис в СВОЙ каталог, под СВОИМ пользователем, СВОЕЙ службой,
#      СО СВОИМ отдельным файлом конфигурации nginx.
#
# Чего НЕ делает:
#   * не трогает существующие сайты, конфиги nginx, юниты systemd и их данные;
#   * не переписывает уже существующий файл с токеном;
#   * не печатает токен ни в лог, ни на экран.
#
# Настройки через переменные окружения (все необязательны):
#   AUREA_KVIZ_DOMAIN   домен для приёма заявок   (по умолчанию kviz.aureadesign.ru)
#   AUREA_KVIZ_ORIGINS  разрешённые Origin через запятую
#   AUREA_KVIZ_PORT     локальный порт            (по умолчанию 8787)
#   AUREA_KVIZ_EMAIL    почта для Let's Encrypt
#   AUREA_KVIZ_SKIP_TLS 1 — не выпускать сертификат
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${AUREA_KVIZ_DOMAIN:-kviz.aureadesign.ru}"
ORIGINS="${AUREA_KVIZ_ORIGINS:-https://kirill-design367.github.io}"
PORT="${AUREA_KVIZ_PORT:-8787}"
LE_EMAIL="${AUREA_KVIZ_EMAIL:-}"
SKIP_TLS="${AUREA_KVIZ_SKIP_TLS:-0}"

SVC=aurea-kviz
SVC_USER=aureakviz
APP_DIR=/opt/$SVC
CFG_DIR=/etc/$SVC
DATA_DIR=/var/lib/$SVC
ACME_DIR=/var/www/$SVC-acme
UNIT=/etc/systemd/system/$SVC.service
MARKER="# managed-by: aurea-kviz installer — этот файл создан установщиком квиза"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
step() { printf '\n%s── %s ──────────────────────────%s\n' "$BLD" "$1" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
die()  { printf '\n%sОстановлено:%s %s\n' "$RED" "$RST" "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" = "0" ] || die "нужен root. Запустите: sudo bash $0"

# ===========================================================================
step "1. Что стоит на сервере"
# ===========================================================================
[ -r /etc/os-release ] && . /etc/os-release || true
echo "  ОС:            ${PRETTY_NAME:-неизвестно}"
echo "  Ядро:          $(uname -r)"
echo "  Python:        $(python3 -V 2>&1 || echo 'НЕТ')"
have systemctl || die "нет systemd — этот установщик рассчитан на systemd"

echo "  Веб-серверы:"
WEB_FOUND=""
for s in nginx apache2 httpd caddy angie; do
  have "$s" && { echo "                 $s  ($("$s" -v 2>&1 | head -1))"; WEB_FOUND="$WEB_FOUND $s"; }
done
[ -n "$WEB_FOUND" ] || echo "                 не найдены"

echo "  Работающие службы (без системных):"
systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null \
  | awk '{print $1}' \
  | grep -Ev '^(systemd-|dbus|cron|rsyslog|ssh|polkit|getty|user@|networkd|resolved|udev|logind|timesyncd|accounts-daemon|unattended|snapd)' \
  | sed 's/^/                 /' || true

if have nginx; then
  echo "  Сайты в nginx (server_name):"
  nginx -T 2>/dev/null | grep -E '^\s*server_name' | tr -s ' ' | sed 's/^ *//; s/;$//' | sort -u | sed 's/^/                 /' || true
  echo "  Файлы конфигурации nginx:"
  nginx -T 2>/dev/null | grep -E '^# configuration file' | sed 's/^# configuration file //; s/:$//' | sed 's/^/                 /' || true
fi

echo "  Занятые порты (слушающие):"
if have ss; then ss -tlnpH 2>/dev/null | awk '{print $4"  "$6}' | sed 's/^/                 /' | head -30; fi

echo "  Адреса:"
ip -4 addr show scope global 2>/dev/null | awk '/inet /{print "                 IPv4 "$2}'
ip -6 addr show scope global 2>/dev/null | awk '/inet6 /{print "                 IPv6 "$2}'

echo "  Доступность api.telegram.org:"
TG_V4=нет; TG_V6=нет
if have curl; then
  c4=$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 8 https://api.telegram.org/ 2>/dev/null || true)
  c6=$(curl -6 -s -o /dev/null -w '%{http_code}' --max-time 8 https://api.telegram.org/ 2>/dev/null || true)
  [ -n "${c4:-}" ] && [ "$c4" != "000" ] && TG_V4="да (HTTP $c4)"
  [ -n "${c6:-}" ] && [ "$c6" != "000" ] && TG_V6="да (HTTP $c6)"
fi
echo "                 по IPv4: $TG_V4"
echo "                 по IPv6: $TG_V6"
if [ "$TG_V4" = "нет" ] && [ "$TG_V6" = "нет" ]; then
  warn "Ни один путь до Telegram сейчас не отвечает. Сервис всё равно поставится:"
  warn "заявки будут сохраняться на диск и уйдут, как только связь появится."
fi

# ===========================================================================
step "2. Проверка, что ничего чужого не будет затронуто"
# ===========================================================================
if [ -f "$UNIT" ] && ! grep -q "$SVC" "$UNIT"; then
  die "файл $UNIT существует и создан не нами. Разбирайтесь вручную."
fi

if have ss; then
  BUSY=$(ss -tlnpH 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$" {print $0}' || true)
  if [ -n "$BUSY" ]; then
    if echo "$BUSY" | grep -q "$SVC\|python3"; then
      ok "порт $PORT занят нашим же сервисом — это перезапуск"
    else
      warn "порт $PORT занят кем-то другим:"
      echo "$BUSY" | sed 's/^/      /'
      for try in $(seq $((PORT+1)) $((PORT+20))); do
        if ! ss -tlnH 2>/dev/null | awk -v p=":$try" '$4 ~ p"$"' | grep -q .; then PORT=$try; break; fi
      done
      ok "выбран свободный порт $PORT"
    fi
  else
    ok "порт $PORT свободен"
  fi
fi

for p in "$APP_DIR" "$DATA_DIR"; do
  if [ -e "$p" ] && [ ! -f "$p/.aurea-kviz" ] && [ -n "$(ls -A "$p" 2>/dev/null)" ]; then
    grep -rqs 'aurea-kviz' "$p" || die "каталог $p существует, не пуст и не наш. Остановился."
  fi
done
ok "чужих файлов на пути установки нет"

# ===========================================================================
step "3. Пользователь и каталоги"
# ===========================================================================
if id "$SVC_USER" >/dev/null 2>&1; then
  ok "пользователь $SVC_USER уже есть"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin --home-dir "$APP_DIR" "$SVC_USER" 2>/dev/null \
    || useradd --system --no-create-home --shell /sbin/nologin --home-dir "$APP_DIR" "$SVC_USER"
  ok "создан системный пользователь $SVC_USER"
fi

install -d -m 0755 -o root -g root "$APP_DIR"
install -d -m 0750 -o root -g "$SVC_USER" "$CFG_DIR"
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR"
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR/outbox"
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR/sent"
install -d -m 0755 -o root -g root "$ACME_DIR"
: > "$APP_DIR/.aurea-kviz"
ok "каталоги на месте: $APP_DIR, $CFG_DIR, $DATA_DIR"

# ===========================================================================
step "4. Код сервиса"
# ===========================================================================
TMP_APP=$(mktemp)
base64 -d > "$TMP_APP" <<'AUREA_KVIZ_APP_B64'
@@APP_PY_BASE64@@
AUREA_KVIZ_APP_B64
python3 -m py_compile "$TMP_APP" || die "код сервиса не компилируется — установка прервана"
if [ -f "$APP_DIR/app.py" ] && cmp -s "$TMP_APP" "$APP_DIR/app.py"; then
  ok "app.py не изменился"
else
  install -m 0644 -o root -g root "$TMP_APP" "$APP_DIR/app.py"
  ok "app.py установлен"
fi
rm -f "$TMP_APP"
find "$APP_DIR" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

# ===========================================================================
step "5. Файл настроек с токеном"
# ===========================================================================
ENV_FILE="$CFG_DIR/kviz.env"
if [ -f "$ENV_FILE" ]; then
  ok "$ENV_FILE уже есть — НЕ трогаю его"
  chmod 0600 "$ENV_FILE"; chown root:root "$ENV_FILE"
  # Порт и Origin могут поменяться между запусками — обновляем только их.
  sed -i "s|^AUREA_KVIZ_PORT=.*|AUREA_KVIZ_PORT=$PORT|" "$ENV_FILE" || true
  sed -i "s|^AUREA_KVIZ_ALLOWED_ORIGINS=.*|AUREA_KVIZ_ALLOWED_ORIGINS=$ORIGINS|" "$ENV_FILE" || true
  grep -q '^AUREA_KVIZ_PORT=' "$ENV_FILE" || echo "AUREA_KVIZ_PORT=$PORT" >> "$ENV_FILE"
  grep -q '^AUREA_KVIZ_ALLOWED_ORIGINS=' "$ENV_FILE" || echo "AUREA_KVIZ_ALLOWED_ORIGINS=$ORIGINS" >> "$ENV_FILE"
else
  umask 077
  cat > "$ENV_FILE" <<ENVEOF
# AUREA · настройки приёмника заявок. Права 600, читает только root (через systemd).
# Впишите токен бота и id получателя, потом: systemctl restart $SVC

AUREA_KVIZ_BOT_TOKEN=
AUREA_KVIZ_CHAT_ID=

AUREA_KVIZ_BIND=127.0.0.1
AUREA_KVIZ_PORT=$PORT
AUREA_KVIZ_DATA_DIR=$DATA_DIR
AUREA_KVIZ_ALLOWED_ORIGINS=$ORIGINS
AUREA_KVIZ_IP_FAMILY=auto
AUREA_KVIZ_RATE_PER_HOUR=8
ENVEOF
  chmod 0600 "$ENV_FILE"; chown root:root "$ENV_FILE"
  warn "создан пустой $ENV_FILE — впишите в него токен и chat_id"
fi

# ===========================================================================
step "6. Служба systemd"
# ===========================================================================
NEW_UNIT=$(mktemp)
cat > "$NEW_UNIT" <<UNITEOF
[Unit]
Description=AUREA · приёмник заявок с квиз-лендинга
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env python3 $APP_DIR/app.py
EnvironmentFile=$ENV_FILE
Restart=always
RestartSec=3
SyslogIdentifier=$SVC

NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectHostname=true
ProtectClock=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RemoveIPC=true
ReadWritePaths=$DATA_DIR
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
UNITEOF
if [ -f "$UNIT" ] && cmp -s "$NEW_UNIT" "$UNIT"; then
  ok "юнит не изменился"
else
  install -m 0644 "$NEW_UNIT" "$UNIT"
  ok "юнит $UNIT записан"
fi
rm -f "$NEW_UNIT"
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1 || true
systemctl restart "$SVC"
sleep 2
if systemctl is-active --quiet "$SVC"; then ok "служба $SVC запущена"; else
  warn "служба не поднялась, последние строки журнала:"
  journalctl -u "$SVC" -n 25 --no-pager | sed 's/^/      /'
  die "разберитесь с журналом и запустите скрипт заново"
fi

# ===========================================================================
step "7. Отдельный конфиг nginx"
# ===========================================================================
NGINX_DONE=0
if have nginx; then
  if [ -d /etc/nginx/sites-available ] && nginx -T 2>/dev/null | grep -q 'sites-enabled'; then
    SITE=/etc/nginx/sites-available/$SVC.conf
    LINK=/etc/nginx/sites-enabled/$SVC.conf
  else
    SITE=/etc/nginx/conf.d/$SVC.conf
    LINK=""
  fi

  if [ -f "$SITE" ] && ! head -3 "$SITE" | grep -q 'managed-by: aurea-kviz'; then
    die "файл $SITE существует и создан не нами. Ничего не меняю."
  fi

  CONFLICT=$(nginx -T 2>/dev/null | grep -E '^\s*server_name' | grep -w "$DOMAIN" | grep -v "$SVC" || true)
  if [ -n "$CONFLICT" ] && [ ! -f "$SITE" ]; then
    warn "домен $DOMAIN уже упоминается в чужом конфиге nginx:"
    echo "$CONFLICT" | sed 's/^/      /'
    warn "конфиг nginx пропущен, чтобы ничего не сломать. Настройте проксирование вручную:"
    warn "  proxy_pass http://127.0.0.1:$PORT;"
  else
    NEW_SITE=$(mktemp)
    cat > "$NEW_SITE" <<SITEEOF
$MARKER
# Файл принадлежит только квиз-лендингу. Другие сайты сервера он не затрагивает.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_DIR;
        default_type "text/plain";
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        client_max_body_size 32k;
    }
}
SITEEOF
    if [ -f "$SITE" ] && cmp -s "$NEW_SITE" "$SITE"; then
      ok "конфиг nginx не изменился"
    else
      install -m 0644 "$NEW_SITE" "$SITE"
      ok "записан $SITE"
    fi
    rm -f "$NEW_SITE"
    [ -n "$LINK" ] && ln -sfn "$SITE" "$LINK" && ok "включён через $LINK"
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx && ok "nginx перечитал конфигурацию"
      NGINX_DONE=1
    else
      warn "nginx -t ругается — откатываю свой файл, чужое не тронуто:"
      nginx -t 2>&1 | sed 's/^/      /'
      rm -f "$SITE"; [ -n "$LINK" ] && rm -f "$LINK"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx
    fi
  fi
  if have getenforce && [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    setsebool -P httpd_can_network_connect 1 2>/dev/null && ok "SELinux: разрешил nginx ходить по сети"
  fi
else
  warn "nginx не найден — проксирование настройте сами на http://127.0.0.1:$PORT"
fi

# ===========================================================================
step "8. Сертификат Let's Encrypt"
# ===========================================================================
if [ "$SKIP_TLS" = "1" ]; then
  warn "выпуск сертификата пропущен по AUREA_KVIZ_SKIP_TLS=1"
elif [ "$NGINX_DONE" != "1" ]; then
  warn "nginx не настроен — сертификат пропущен"
elif [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  ok "сертификат для $DOMAIN уже есть"
  if ! grep -q 'listen 443' "$SITE"; then warn "но в конфиге нет блока 443 — допишу ниже"; fi
else
  if ! have certbot; then
    if have apt-get; then
      DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null 2>&1 || true
    elif have dnf; then dnf install -y -q certbot >/dev/null 2>&1 || true
    elif have yum; then yum install -y -q certbot >/dev/null 2>&1 || true
    fi
  fi
  if have certbot; then
    RESOLVED=$(getent ahosts "$DOMAIN" 2>/dev/null | head -1 | awk '{print $1}')
    if [ -z "$RESOLVED" ]; then
      warn "$DOMAIN не резолвится. Заведите A и AAAA записи и запустите скрипт заново."
    else
      ok "$DOMAIN резолвится в $RESOLVED"
      CB_ARGS="certonly --webroot -w $ACME_DIR -d $DOMAIN --agree-tos --non-interactive"
      if [ -n "$LE_EMAIL" ]; then CB_ARGS="$CB_ARGS -m $LE_EMAIL"; else CB_ARGS="$CB_ARGS --register-unsafely-without-email"; fi
      if certbot $CB_ARGS; then ok "сертификат выпущен"; else warn "certbot не справился — сайт останется на http"; fi
    fi
  else
    warn "certbot не установлен и не ставится автоматически"
  fi
fi

if [ -d "/etc/letsencrypt/live/$DOMAIN" ] && [ -f "$SITE" ] && ! grep -q 'listen 443' "$SITE"; then
  cat >> "$SITE" <<TLSEOF

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:AureaKviz:1m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        client_max_body_size 32k;
    }
}
TLSEOF
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx && ok "https включён для $DOMAIN"
  else
    warn "блок 443 ломает конфиг — убираю его, чужое не тронуто"
    nginx -t 2>&1 | sed 's/^/      /'
    python3 - "$SITE" <<'PYCUT'
import sys
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
head, sep, _ = text.partition('\nserver {\n    listen 443')
open(path, 'w', encoding='utf-8').write(head + '\n' if sep else text)
PYCUT
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
  fi
fi

# ===========================================================================
step "9. Проверка"
# ===========================================================================
HEALTH=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/health" || true)
if [ -n "$HEALTH" ]; then ok "сервис отвечает: $HEALTH"; else warn "сервис не ответил на /api/health"; fi

if grep -q '^AUREA_KVIZ_BOT_TOKEN=$' "$ENV_FILE" 2>/dev/null || grep -q '^AUREA_KVIZ_CHAT_ID=$' "$ENV_FILE" 2>/dev/null; then
  warn "токен или chat_id ещё не заполнены"
fi

echo
printf '%sГотово.%s\n\n' "$BLD" "$RST"
cat <<SUMEOF
  Служба:     systemctl status $SVC
  Журнал:     journalctl -u $SVC -f
  Настройки:  $ENV_FILE   (права 600)
  Данные:     $DATA_DIR/leads.jsonl   — все заявки
              $DATA_DIR/outbox/       — не ушедшие в Telegram
  Локально:   http://127.0.0.1:$PORT/api/health
  Снаружи:    https://$DOMAIN/api/lead

  Дальше:
    1. Впишите токен и chat_id:   nano $ENV_FILE
    2. Перезапустите:             systemctl restart $SVC
    3. Проверьте путь до Telegram: journalctl -u $SVC -n 20 --no-pager | grep Telegram
SUMEOF
