#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AUREA · установка приёмника заявок с квиз-лендинга.
#
# Запуск под root:   bash install.sh
# Повторный запуск безопасен.
#
# Что делает:
#   1. осматривает сервер и печатает, что на нём стоит;
#   2. проверяет, не займёт ли он чужое (порт, имя юнита, конфиг nginx, домен);
#   3. ставит службу в СВОЙ каталог, под СВОИМ пользователем, СВОЕЙ службой,
#      СО СВОИМ отдельным файлом конфигурации nginx.
#
# Чего НЕ делает:
#   * не трогает существующие сайты, конфиги nginx, юниты systemd и их данные;
#   * не переписывает уже существующий файл настроек — только дописывает
#     недостающие строки;
#   * не ставит пакеты и не меняет политику SELinux без явного разрешения;
#   * не печатает токен ни в лог, ни на экран.
#
# Настройки через переменные окружения (все необязательны):
#   AUREA_KVIZ_DOMAIN     домен приёма заявок  (по умолчанию kviz.aureadesign.ru)
#   AUREA_KVIZ_ORIGINS    разрешённые Origin через запятую
#   AUREA_KVIZ_PORT       локальный порт       (по умолчанию 8787)
#   AUREA_KVIZ_EMAIL      почта для Let's Encrypt
#   AUREA_KVIZ_SKIP_TLS=1 не выпускать сертификат
#   AUREA_KVIZ_ALLOW_APT=1 разрешить установку certbot через пакетный менеджер
#   AUREA_KVIZ_ALLOW_SELINUX=1 разрешить setsebool httpd_can_network_connect
# ---------------------------------------------------------------------------
set -euo pipefail

SVC=aurea-kviz
SVC_USER=aureakviz
APP_DIR=/opt/$SVC
CFG_DIR=/etc/$SVC
DATA_DIR=/var/lib/$SVC
ACME_DIR=/var/www/$SVC-acme
UNIT=/etc/systemd/system/$SVC.service
ENV_FILE=$CFG_DIR/kviz.env
MARKER="# managed-by: aurea-kviz installer"

DOMAIN="${AUREA_KVIZ_DOMAIN:-kviz.aureadesign.ru}"
ORIGINS="${AUREA_KVIZ_ORIGINS:-https://kirill-design367.github.io}"
LE_EMAIL="${AUREA_KVIZ_EMAIL:-}"
SKIP_TLS="${AUREA_KVIZ_SKIP_TLS:-0}"
ALLOW_APT="${AUREA_KVIZ_ALLOW_APT:-0}"
ALLOW_SELINUX="${AUREA_KVIZ_ALLOW_SELINUX:-0}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
step() { printf '\n%s── %s ──────────────────────────%s\n' "$BLD" "$1" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
die()  { printf '\n%sОстановлено:%s %s\n' "$RED" "$RST" "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" = "0" ] || die "нужен root. Запустите: sudo bash $0"
have systemctl || die "нет systemd — этот установщик рассчитан на systemd"

# Порт: сначала то, что уже записано в настройках, потом переменная, потом
# значение по умолчанию. Иначе автоподбор при каждом запуске давал бы новый
# порт, и nginx проксировал бы в пустоту.
PORT_FROM_ENV=""
[ -f "$ENV_FILE" ] && PORT_FROM_ENV=$(sed -n 's/^AUREA_KVIZ_PORT=\([0-9]\+\).*/\1/p' "$ENV_FILE" | head -1)
PORT="${PORT_FROM_ENV:-${AUREA_KVIZ_PORT:-8787}}"

# ===========================================================================
step "1. Что стоит на сервере"
# ===========================================================================
[ -r /etc/os-release ] && . /etc/os-release || true
echo "  ОС:            ${PRETTY_NAME:-неизвестно}"
echo "  Ядро:          $(uname -r)"
echo "  Python:        $(python3 -V 2>&1 || echo 'НЕТ')"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' 2>/dev/null \
  || die "нужен Python 3.7 или новее"

echo "  Веб-серверы:"
FOUND_WEB=0
for s in nginx apache2 httpd caddy angie; do
  if have "$s"; then echo "                 $s  ($("$s" -v 2>&1 | head -1))"; FOUND_WEB=1; fi
done
[ "$FOUND_WEB" = "1" ] || echo "                 не найдены"

echo "  Панели управления хостингом:"
PANEL=""
for p in /usr/local/mgr5:ISPmanager /usr/local/fastpanel2:FASTPANEL \
         /opt/psa:Plesk /usr/local/hestia:HestiaCP /usr/local/cpanel:cPanel \
         /usr/local/vesta:VestaCP /opt/cloudpanel:CloudPanel; do
  if [ -d "${p%%:*}" ]; then PANEL="${p##*:}"; echo "                 НАЙДЕНА: $PANEL"; fi
done
[ -n "$PANEL" ] || echo "                 не найдены"

echo "  Работающие службы (без системных):"
systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null \
  | awk '{print $1}' \
  | grep -Ev '^(systemd-|dbus|cron|rsyslog|ssh|polkit|getty|user@|networkd|resolved|udev|logind|timesyncd|accounts-daemon|unattended|snapd)' \
  | sed 's/^/                 /' || true

if have nginx; then
  echo "  Сайты в nginx (server_name):"
  nginx -T 2>/dev/null | grep -E '^[[:space:]]*server_name' | tr -s ' ' | sed 's/^ *//; s/;$//' \
    | sort -u | sed 's/^/                 /' || true
  echo "  Файлы конфигурации nginx:"
  nginx -T 2>/dev/null | grep -E '^# configuration file' | sed 's/^# configuration file //; s/:$//' \
    | sed 's/^/                 /' || true
fi

echo "  Занятые порты:"
have ss && ss -tlnpH 2>/dev/null | awk '{print $4"  "$6}' | sed 's/^/                 /' | head -30

echo "  Адреса:"
ip -4 addr show scope global 2>/dev/null | awk '/inet /{print "                 IPv4 "$2}'
ip -6 addr show scope global 2>/dev/null | awk '/inet6 /{print "                 IPv6 "$2}'
V6ROUTE=$(ip -6 route show default 2>/dev/null | head -1)
echo "                 маршрут IPv6 по умолчанию: ${V6ROUTE:-НЕТ}"
V6DISABLED=$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null || echo '?')
echo "                 net.ipv6.conf.all.disable_ipv6 = $V6DISABLED"

echo "  Доступность api.telegram.org (полный HTTPS-запрос, не только TCP):"
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
  warn "Ни один путь до Telegram сейчас не отвечает. Служба всё равно поставится:"
  warn "заявки будут сохраняться на диск и уйдут, как только связь появится."
fi

have getenforce && echo "  SELinux:       $(getenforce 2>/dev/null)"

# ===========================================================================
step "2. Проверка, что ничего чужого не будет затронуто"
# ===========================================================================
if [ -f "$UNIT" ] && ! grep -q "SyslogIdentifier=$SVC" "$UNIT"; then
  die "файл $UNIT существует и создан не нами. Разбирайтесь вручную."
fi

# Владелец порта определяется по cgroup процесса, а не по имени: чужой
# telegram-бот почти наверняка тоже на python3, и совпадение по имени
# означало бы попытку встать поверх него.
port_owner_is_ours() {
  local pid
  pid=$(ss -tlnpH 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p {print $0}' \
        | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "$pid" ] || return 1
  grep -qs "$SVC" "/proc/$pid/cgroup"
}

if have ss && ss -tlnH 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p' | grep -q .; then
  if port_owner_is_ours; then
    ok "порт $PORT занят нашей же службой — это перезапуск"
  elif [ -n "$PORT_FROM_ENV" ]; then
    die "порт $PORT записан в $ENV_FILE, но занят чужим процессом. Освободите его или укажите другой в файле настроек."
  else
    warn "порт $PORT занят кем-то другим:"
    ss -tlnpH 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p' | sed 's/^/      /'
    for try in $(seq $((PORT + 1)) $((PORT + 20))); do
      if ! ss -tlnH 2>/dev/null | awk -v p=":$try\$" '$4 ~ p' | grep -q .; then PORT=$try; break; fi
    done
    ok "выбран свободный порт $PORT"
  fi
else
  ok "порт $PORT свободен"
fi

for p in "$APP_DIR" "$DATA_DIR"; do
  if [ -e "$p" ] && [ ! -e "$p/.aurea-kviz" ] && [ -n "$(ls -A "$p" 2>/dev/null)" ]; then
    die "каталог $p существует, не пуст и не наш. Остановился."
  fi
done
ok "чужих файлов на пути установки нет"

if [ -n "$PANEL" ]; then
  warn "На сервере стоит $PANEL. Панели перегенерируют конфиги nginx из шаблонов"
  warn "и могут снести добавленный вручную файл. Если после действий в панели"
  warn "форма перестанет отправляться — заведите поддомен $DOMAIN средствами"
  warn "панели и пропишите проксирование на http://127.0.0.1:$PORT"
fi

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
: > "$DATA_DIR/.aurea-kviz"
chown "$SVC_USER:$SVC_USER" "$DATA_DIR/.aurea-kviz"
ok "каталоги на месте: $APP_DIR, $CFG_DIR, $DATA_DIR"

# ===========================================================================
step "4. Код службы"
# ===========================================================================
CHANGED=0
TMP_APP=$(mktemp)
base64 -d > "$TMP_APP" <<'AUREA_KVIZ_APP_B64'
@@APP_PY_BASE64@@
AUREA_KVIZ_APP_B64
python3 -m py_compile "$TMP_APP" || die "код службы не компилируется — установка прервана"
if [ -f "$APP_DIR/app.py" ] && cmp -s "$TMP_APP" "$APP_DIR/app.py"; then
  ok "app.py не изменился"
else
  install -m 0644 -o root -g root "$TMP_APP" "$APP_DIR/app.py"
  CHANGED=1
  ok "app.py установлен"
fi
rm -f "$TMP_APP"
find "$APP_DIR" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

# ===========================================================================
step "5. Файл настроек с токеном"
# ===========================================================================
# Существующие значения не переписываются: владелец мог поправить их руками.
# Дописываются только недостающие ключи.
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  printf '%s\n' \
    "# AUREA · настройки приёмника заявок. Права 600, читает systemd под root." \
    "# Впишите токен бота и id получателя, потом: systemctl restart $SVC" \
    "" > "$ENV_FILE"
  warn "создан пустой $ENV_FILE"
else
  ok "$ENV_FILE уже есть — существующие значения не трогаю"
fi

add_key() {
  grep -q "^$1=" "$ENV_FILE" || { printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; ok "дописан $1"; }
}
add_key AUREA_KVIZ_BOT_TOKEN ""
add_key AUREA_KVIZ_CHAT_ID ""
add_key AUREA_KVIZ_BIND "127.0.0.1"
add_key AUREA_KVIZ_PORT "$PORT"
add_key AUREA_KVIZ_DATA_DIR "$DATA_DIR"
add_key AUREA_KVIZ_ALLOWED_ORIGINS "$ORIGINS"
add_key AUREA_KVIZ_IP_FAMILY "auto"
add_key AUREA_KVIZ_RATE_PER_HOUR "8"
chmod 0600 "$ENV_FILE"; chown root:root "$ENV_FILE"

CUR_ORIGINS=$(sed -n 's/^AUREA_KVIZ_ALLOWED_ORIGINS=//p' "$ENV_FILE" | head -1)
if [ "$CUR_ORIGINS" != "$ORIGINS" ]; then
  warn "в настройках AUREA_KVIZ_ALLOWED_ORIGINS = $CUR_ORIGINS"
  warn "а ожидался $ORIGINS — если адрес сайта сменился, поправьте вручную"
fi

# ===========================================================================
step "6. Служба systemd"
# ===========================================================================
NEW_UNIT=$(mktemp)
base64 -d > "$NEW_UNIT" <<'AUREA_KVIZ_UNIT_B64'
@@UNIT_BASE64@@
AUREA_KVIZ_UNIT_B64
if [ -f "$UNIT" ] && cmp -s "$NEW_UNIT" "$UNIT"; then
  ok "описание службы не изменилось"
else
  install -m 0644 "$NEW_UNIT" "$UNIT"
  CHANGED=1
  ok "описание службы записано в $UNIT"
fi
rm -f "$NEW_UNIT"

systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1 || true
# Перезапуск только по делу: лишний рестарт роняет соединения на ровном месте.
if [ "$CHANGED" = "1" ] || ! systemctl is-active --quiet "$SVC"; then
  systemctl restart "$SVC"
  sleep 2
  ok "служба перезапущена"
else
  ok "служба уже работает и не менялась — не трогаю"
fi

if ! systemctl is-active --quiet "$SVC"; then
  warn "служба не поднялась, последние строки журнала:"
  journalctl -u "$SVC" -n 25 --no-pager | sed 's/^/      /'
  die "разберитесь с журналом и запустите скрипт заново"
fi
ok "служба $SVC работает"

# ===========================================================================
step "7. Отдельный конфиг nginx"
# ===========================================================================
NGINX_DONE=0
SITE=""
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

  # Точное совпадение server_name, а не grep -w: точки в шаблоне это «любой
  # символ», и sub.kviz.aureadesign.ru давал бы ложный конфликт.
  CONFLICT=$(nginx -T 2>/dev/null \
    | grep -E '^[[:space:]]*server_name' \
    | tr -s ' ' | sed 's/^ *server_name //; s/;$//' \
    | tr ' ' '\n' \
    | grep -Fxq "$DOMAIN" && echo yes || echo no)
  OURS_ALREADY=$([ -f "$SITE" ] && echo yes || echo no)

  if [ "$CONFLICT" = "yes" ] && [ "$OURS_ALREADY" = "no" ]; then
    warn "домен $DOMAIN уже объявлен в чужом конфиге nginx."
    warn "Конфиг пропущен, чтобы ничего не сломать. Настройте проксирование сами:"
    warn "  proxy_pass http://127.0.0.1:$PORT;"
  else
    # nginx до 1.25.1 не понимает отдельную директиву «http2 on».
    NGINX_VER=$(nginx -v 2>&1 | sed 's/.*\///; s/[^0-9.].*//')
    if printf '%s\n1.25.1\n' "$NGINX_VER" | sort -V | head -1 | grep -qx "1.25.1"; then
      HTTP2_LINE="    http2 on;"
      SSL_LISTEN_4="    listen 443 ssl;"
      SSL_LISTEN_6="    listen [::]:443 ssl;"
    else
      HTTP2_LINE=""
      SSL_LISTEN_4="    listen 443 ssl http2;"
      SSL_LISTEN_6="    listen [::]:443 ssl http2;"
    fi
    ok "nginx $NGINX_VER — директива http2 подобрана под версию"

    HAS_CERT=no
    [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && HAS_CERT=yes

    # Конфиг генерируется целиком, а не дописывается: дописывание ломается,
    # если файл когда-нибудь правили руками.
    write_site() {
      cat <<SITEEOF
$MARKER — файл принадлежит только квиз-лендингу.
# Другие сайты этого сервера он не затрагивает.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_DIR;
        default_type "text/plain";
    }

$(if [ "$1" = "yes" ]; then
cat <<REDIR
    location / {
        return 301 https://\$host\$request_uri;
    }
REDIR
else
cat <<PROXY
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
PROXY
fi)
}
$(if [ "$1" = "yes" ]; then
cat <<TLSEOF

server {
$SSL_LISTEN_4
$SSL_LISTEN_6
$HTTP2_LINE
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
fi)
SITEEOF
    }

    apply_site() {
      local want_tls="$1" tmp backup
      tmp=$(mktemp)
      write_site "$want_tls" > "$tmp"
      if [ -f "$SITE" ] && cmp -s "$tmp" "$SITE"; then
        rm -f "$tmp"; ok "конфиг nginx не изменился"; NGINX_DONE=1; return 0
      fi
      backup=""
      if [ -f "$SITE" ]; then backup=$(mktemp); cp "$SITE" "$backup"; fi
      install -m 0644 "$tmp" "$SITE"; rm -f "$tmp"
      [ -n "$LINK" ] && ln -sfn "$SITE" "$LINK"
      if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx && ok "nginx перечитал конфигурацию"
        [ -n "$backup" ] && rm -f "$backup"
        NGINX_DONE=1
        return 0
      fi
      warn "nginx -t ругается, откатываю только свой файл:"
      nginx -t 2>&1 | sed 's/^/      /'
      if [ -n "$backup" ]; then install -m 0644 "$backup" "$SITE"; rm -f "$backup";
      else rm -f "$SITE"; [ -n "$LINK" ] && rm -f "$LINK"; fi
      nginx -t >/dev/null 2>&1 && systemctl reload nginx
      return 1
    }

    apply_site "$HAS_CERT" || warn "конфиг nginx не применён"
  fi

  if have getenforce && [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    if [ "$ALLOW_SELINUX" = "1" ]; then
      setsebool -P httpd_can_network_connect 1 && ok "SELinux: разрешил nginx ходить по сети"
    else
      warn "SELinux в режиме Enforcing. Чтобы nginx смог проксировать, нужна команда:"
      warn "  setsebool -P httpd_can_network_connect 1"
      warn "Она действует на ВСЕ httpd-процессы сервера, поэтому сама не выполняется."
      warn "Разрешить: перезапустите скрипт с AUREA_KVIZ_ALLOW_SELINUX=1"
    fi
  fi
else
  warn "nginx не найден — проксирование настройте сами на http://127.0.0.1:$PORT"
fi

# ===========================================================================
step "8. Сертификат Let's Encrypt"
# ===========================================================================
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ "$SKIP_TLS" = "1" ]; then
  warn "выпуск сертификата пропущен по AUREA_KVIZ_SKIP_TLS=1"
elif [ "$NGINX_DONE" != "1" ]; then
  warn "nginx не настроен — сертификат пропущен"
elif [ -f "$CERT_DIR/fullchain.pem" ] \
     && openssl x509 -checkend 2592000 -noout -in "$CERT_DIR/fullchain.pem" >/dev/null 2>&1; then
  # Повторные обращения к Let's Encrypt быстро упираются в лимит: пять
  # одинаковых сертификатов в неделю — и домен закрыт на неделю.
  ok "сертификат для $DOMAIN есть и действует ещё больше месяца"
else
  if ! have certbot; then
    if [ "$ALLOW_APT" = "1" ]; then
      if have apt-get; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null 2>&1 || true
      elif have dnf; then dnf install -y -q certbot >/dev/null 2>&1 || true
      elif have yum; then yum install -y -q certbot >/dev/null 2>&1 || true
      fi
    else
      warn "certbot не установлен. Ставить пакеты на чужой сервер сам не буду."
      warn "Поставьте вручную:  apt-get install -y certbot"
      warn "или перезапустите скрипт с AUREA_KVIZ_ALLOW_APT=1"
    fi
  fi
  if have certbot; then
    RESOLVED=$(getent ahosts "$DOMAIN" 2>/dev/null | head -1 | awk '{print $1}')
    if [ -z "$RESOLVED" ]; then
      warn "$DOMAIN не резолвится. Заведите записи A и AAAA и запустите скрипт заново."
    else
      ok "$DOMAIN резолвится в $RESOLVED"
      CB="certonly --webroot -w $ACME_DIR -d $DOMAIN --agree-tos --non-interactive --keep-until-expiring"
      if [ -n "$LE_EMAIL" ]; then CB="$CB -m $LE_EMAIL"; else CB="$CB --register-unsafely-without-email"; fi
      if certbot $CB; then
        ok "сертификат выпущен"
        apply_site yes || warn "не удалось включить https"
      else
        warn "certbot не справился — сайт останется на http"
      fi
    fi
  fi
fi

# ===========================================================================
step "9. Проверка"
# ===========================================================================
HEALTH=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/health" || true)
if [ -n "$HEALTH" ]; then ok "служба отвечает: $HEALTH"; else warn "служба не ответила на /api/health"; fi

echo "  Путь до Telegram по журналу:"
journalctl -u "$SVC" -n 60 --no-pager 2>/dev/null | grep -i 'telegram' | tail -4 | sed 's/^/      /' || true

if grep -q '^AUREA_KVIZ_BOT_TOKEN=$' "$ENV_FILE" 2>/dev/null; then
  warn "токен ещё не заполнен — заявки будут копиться в очереди"
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
    1. Впишите токен и chat_id:    nano $ENV_FILE
    2. Перезапустите:              systemctl restart $SVC
    3. Проверьте путь до Telegram: journalctl -u $SVC -n 30 --no-pager | grep -i telegram
SUMEOF
