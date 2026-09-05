#!/usr/bin/env bash
# AUREA · осмотр сервера перед установкой. Только чтение, ничего не меняет.
# Запуск:  sudo bash survey.sh
set -uo pipefail

line() { printf '\n\033[1m── %s ─────────────────────────────────────\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "AUREA · осмотр сервера · $(date -Is 2>/dev/null || date)"

line "Система"
[ -r /etc/os-release ] && . /etc/os-release && echo "ОС: ${PRETTY_NAME:-неизвестно}"
echo "Ядро: $(uname -srm)"
have systemd-detect-virt && echo "Виртуализация: $(systemd-detect-virt || echo нет)"
echo "Аптайм: $(uptime -p 2>/dev/null || uptime)"
echo "Память:"; free -h 2>/dev/null | sed 's/^/  /'
echo "Диск:";   df -hT / /var 2>/dev/null | sed 's/^/  /'

line "Веб-серверы"
for s in nginx apache2 httpd caddy angie openresty haproxy traefik; do
  if have "$s"; then echo "НАЙДЕН: $s — $("$s" -v 2>&1 | head -1)"; fi
done
if have nginx; then
  echo "Проверка конфигурации nginx:"; nginx -t 2>&1 | sed 's/^/  /'
  echo "Пути конфигов (nginx -T, только имена файлов):"
  nginx -T 2>/dev/null | grep -E '^# configuration file' | sed 's/^# configuration file /  /' | sed 's/:$//'
  echo "Объявленные server_name:"
  nginx -T 2>/dev/null | grep -E '^\s*server_name' | sed 's/^\s*/  /' | sort -u
  echo "Слушающие директивы listen:"
  nginx -T 2>/dev/null | grep -E '^\s*listen' | sed 's/^\s*/  /' | sort -u
fi

line "Службы systemd (запущенные, без системных)"
if have systemctl; then
  systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null \
    | awk '{print $1}' \
    | grep -Ev '^(systemd-|dbus|cron|rsyslog|ssh|polkit|getty|user@|networkd|resolved|udev|logind|timesyncd|accounts-daemon|unattended)' \
    | sed 's/^/  /'
  echo "Юниты, похожие на боты/приложения:"
  systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null \
    | grep -Ei 'bot|telegram|aurea|kviz|quiz|app|node|python|gunicorn|uwsgi|pm2' | sed 's/^/  /'
fi

line "Открытые порты"
if have ss; then ss -tulpnH 2>/dev/null | sed 's/^/  /'
elif have netstat; then netstat -tulpn 2>/dev/null | sed 's/^/  /'; fi

line "Языки и утилиты"
for c in python3 python node npm pm2 docker podman certbot git curl wget rsync ufw firewall-cmd; do
  if have "$c"; then printf '  %-12s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"; else printf '  %-12s нет\n' "$c"; fi
done

line "Сертификаты"
[ -d /etc/letsencrypt/live ] && ls -1 /etc/letsencrypt/live 2>/dev/null | sed 's/^/  /' || echo "  каталог /etc/letsencrypt/live не найден"
have certbot && certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry' | sed 's/^/  /'

line "Сайты в /var/www, /srv, /opt, /home"
for d in /var/www /srv /opt /home; do
  [ -d "$d" ] && { echo "$d:"; ls -1 "$d" 2>/dev/null | head -20 | sed 's/^/  /'; }
done

line "Сеть и доступность Telegram"
echo "IPv4-адреса:"; ip -4 addr show scope global 2>/dev/null | awk '/inet /{print "  "$2"  ("$NF")"}'
echo "IPv6-адреса:"; ip -6 addr show scope global 2>/dev/null | awk '/inet6 /{print "  "$2"  ("$NF")"}'
echo "Маршрут по умолчанию IPv6: $(ip -6 route show default 2>/dev/null | head -1 || echo нет)"
for fam in 4 6; do
  printf 'api.telegram.org по IPv%s: ' "$fam"
  if have curl; then
    code=$(curl -"$fam" -s -o /dev/null -w '%{http_code}' --max-time 8 https://api.telegram.org/ 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; then echo "отвечает (HTTP $code)"; else echo "НЕ отвечает"; fi
  else echo "нет curl"; fi
done

line "Файрвол"
have ufw && ufw status verbose 2>/dev/null | sed 's/^/  /'
have firewall-cmd && firewall-cmd --list-all 2>/dev/null | sed 's/^/  /'
have iptables && { echo "iptables INPUT:"; iptables -S INPUT 2>/dev/null | head -20 | sed 's/^/  /'; }

line "SELinux / AppArmor"
have getenforce && echo "  SELinux: $(getenforce 2>/dev/null)"
have aa-status && echo "  AppArmor: $(aa-status --enabled >/dev/null 2>&1 && echo включён || echo выключен)"

line "Панели управления хостингом"
PANEL_FOUND=no
for d in /usr/local/mgr5 /usr/local/fastpanel2 /usr/local/hestia /usr/local/vesta \
         /usr/local/cpanel /opt/psa /www/server/panel /usr/local/ispmgr; do
  [ -e "$d" ] && { echo "  НАЙДЕНА: $d"; PANEL_FOUND=yes; }
done
[ "$PANEL_FOUND" = no ] && echo "  панелей не видно — конфиги nginx правятся руками"

line "Домен cenasaita.ru"
for host in cenasaita.ru www.cenasaita.ru; do
  echo "  $host:"
  if have getent; then
    getent ahostsv4 "$host" 2>/dev/null | awk '{print "    A    "$1}' | sort -u
    getent ahostsv6 "$host" 2>/dev/null | awk '{print "    AAAA "$1}' | sort -u
  fi
done
echo "  Объявлен ли домен в nginx:"
if have nginx; then
  nginx -T 2>/dev/null | grep -E '^[[:space:]]*server_name' | tr -s ' ' \
    | sed 's/^ *server_name //; s/;$//' | tr ' ' '\n' \
    | grep -Fx -e cenasaita.ru -e www.cenasaita.ru | sed 's/^/    занят: /' \
    || echo "    свободен, ни в одном server_name не встречается"
fi
echo "  Каталог /var/www/cenasaita.ru: $([ -e /var/www/cenasaita.ru ] && echo СУЩЕСТВУЕТ || echo свободен)"

line "Кто слушает 80 и 443"
if have ss; then
  ss -tlnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print "  "$0}' || true
fi

line "Соответствие server_name и root в nginx"
# Нужно, чтобы новый сайт не сел на чужой каталог.
if have nginx; then
  nginx -T 2>/dev/null | awk '
    /^[[:space:]]*server[[:space:]]*\{/ { inblock=1; name=""; root="" }
    inblock && /^[[:space:]]*server_name/ { gsub(/;/,""); sub(/^[[:space:]]*server_name[[:space:]]*/,""); name=$0 }
    inblock && /^[[:space:]]*root/ { gsub(/;/,""); sub(/^[[:space:]]*root[[:space:]]*/,""); root=$0 }
    inblock && /^[[:space:]]*\}/ { if (name != "") printf "  %-40s %s\n", name, (root == "" ? "(без root)" : root); inblock=0 }
  ' | sort -u
fi

line "Доступ по SSH (для ключа выкладки)"
if [ -r /etc/ssh/sshd_config ]; then
  grep -Ei '^[[:space:]]*(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|AllowUsers|AllowGroups|AuthorizedKeysFile)' \
    /etc/ssh/sshd_config 2>/dev/null | sed 's/^/  /' || echo "  директивы по умолчанию"
  for f in /etc/ssh/sshd_config.d/*.conf; do
    [ -r "$f" ] && { echo "  $f:"; grep -Ev '^\s*(#|$)' "$f" | sed 's/^/    /'; }
  done
fi
echo "  Пользователи с оболочкой (кандидаты и занятые имена):"
awk -F: '$3 >= 1000 && $3 < 65534 {print "    "$1"  uid="$3"  "$7}' /etc/passwd 2>/dev/null
id aureadeploy >/dev/null 2>&1 && echo "    пользователь aureadeploy СУЩЕСТВУЕТ" || echo "    пользователь aureadeploy свободен"

line "Автопродление сертификатов"
if have systemctl; then
  systemctl list-timers --all --no-pager 2>/dev/null | grep -Ei 'certbot|acme|renew' | sed 's/^/  /' \
    || echo "  таймеров certbot не видно"
fi
for f in /etc/cron.d/certbot /etc/cron.daily/certbot; do
  [ -e "$f" ] && echo "  есть $f"
done

line "Что уже занято под aurea-kviz"
for p in /opt/aurea-kviz /etc/aurea-kviz /var/lib/aurea-kviz; do
  [ -e "$p" ] && echo "  СУЩЕСТВУЕТ: $p" || echo "  свободно: $p"
done
id aureakviz >/dev/null 2>&1 && echo "  пользователь aureakviz СУЩЕСТВУЕТ" || echo "  пользователь aureakviz свободен"
have ss && { ss -tlnpH 2>/dev/null | grep -q ':8787' && echo "  порт 8787 ЗАНЯТ" || echo "  порт 8787 свободен"; }

line "Итог одной строкой"
printf '  ОС=%s | nginx=%s | python3=%s | certbot=%s | rsync=%s | панель=%s\n' \
  "${PRETTY_NAME:-?}" \
  "$(have nginx && nginx -v 2>&1 | sed 's/.*\///' || echo нет)" \
  "$(have python3 && python3 -V 2>&1 | awk '{print $2}' || echo нет)" \
  "$(have certbot && echo есть || echo нет)" \
  "$(have rsync && echo есть || echo нет)" \
  "$PANEL_FOUND"

echo
echo "Осмотр закончен. Ничего не изменено."
