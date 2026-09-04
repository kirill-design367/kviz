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

line "Что уже занято под aurea-kviz"
for p in /opt/aurea-kviz /etc/aurea-kviz /var/lib/aurea-kviz; do
  [ -e "$p" ] && echo "  СУЩЕСТВУЕТ: $p" || echo "  свободно: $p"
done
id aureakviz >/dev/null 2>&1 && echo "  пользователь aureakviz СУЩЕСТВУЕТ" || echo "  пользователь aureakviz свободен"
have ss && { ss -tlnpH 2>/dev/null | grep -q ':8787' && echo "  порт 8787 ЗАНЯТ" || echo "  порт 8787 свободен"; }

echo
echo "Осмотр закончен. Ничего не изменено."
