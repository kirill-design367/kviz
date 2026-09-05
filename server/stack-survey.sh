#!/usr/bin/env bash
# AUREA · осмотр docker-стека перед встраиванием квиза.
#
# Только чтение: ни одного контейнера не создаётся, не запускается
# и не останавливается, ни один файл не меняется.
#
# ЗНАЧЕНИЯ ПЕРЕМЕННЫХ ИЗ .env НЕ ПЕЧАТАЮТСЯ — только их имена. По той же
# причине здесь нет «docker compose config»: эта команда подставляет
# значения из .env прямо в вывод, и токен уехал бы в переписку.
#
# Запуск:  sudo bash stack-survey.sh
set -uo pipefail

STACK="${AUREA_STACK_DIR:-/opt/aurea/studio}"

line() { printf '\n\033[1m── %s ─────────────────────────────────────\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "AUREA · осмотр стека · $(date -Is 2>/dev/null || date)"
echo "Каталог стека: $STACK"

if [ ! -d "$STACK" ]; then
  echo "ОШИБКА: каталога $STACK нет. Укажите верный: AUREA_STACK_DIR=/путь bash stack-survey.sh"
  exit 1
fi
cd "$STACK" || exit 1

line "Каталог стека"
ls -la | sed 's/^/  /'
for d in deploy nginx conf config; do
  [ -d "$d" ] && { echo "  $d/:"; ls -la "$d" | sed 's/^/    /'; }
done

line "docker-compose.yml"
if [ -f docker-compose.yml ]; then cat docker-compose.yml
elif [ -f compose.yaml ]; then cat compose.yaml
else echo "  не найден"; fi

line "Конфигурация nginx"
for f in deploy/nginx.https.conf deploy/nginx.conf nginx.conf; do
  [ -f "$f" ] && { echo "  ---- $f ----"; cat "$f"; }
done

line "Имена ключей .env (ЗНАЧЕНИЯ НЕ ПЕЧАТАЮТСЯ)"
for f in .env .env.production; do
  [ -f "$f" ] && {
    echo "  $f:"
    sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*=.*/    \1/p' "$f"
  }
done

line "Контейнеры и образы"
if have docker; then
  docker compose ps 2>/dev/null | sed 's/^/  /' || docker-compose ps 2>/dev/null | sed 's/^/  /'
  echo "  Образы:"
  docker compose images 2>/dev/null | sed 's/^/    /'
  echo "  Все контейнеры хоста:"
  docker ps -a --format '    {{.Names}}  {{.Image}}  {{.Status}}  {{.Ports}}'
fi

line "Сети и подсети"
if have docker; then
  docker network ls --format '  {{.Name}}  {{.Driver}}  {{.Scope}}'
  for net in $(docker network ls --format '{{.Name}}' | grep -Ev '^(bridge|host|none)$'); do
    sub=$(docker network inspect "$net" -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)
    members=$(docker network inspect "$net" -f '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null)
    printf '  %-28s подсеть: %-20s контейнеры: %s\n' "$net" "${sub:-?}" "${members:-нет}"
  done
fi

line "Тома и что в них лежит"
if have docker; then
  docker volume ls --format '  {{.Name}}'
  for v in $(docker volume ls --format '{{.Name}}'); do
    mp=$(docker volume inspect "$v" -f '{{.Mountpoint}}' 2>/dev/null)
    [ -d "$mp" ] || continue
    printf '  %s → %s\n' "$v" "$mp"
    ls -1 "$mp" 2>/dev/null | head -8 | sed 's/^/      /'
    [ -d "$mp/live" ] && { echo "      сертификаты:"; ls -1 "$mp/live" 2>/dev/null | sed 's/^/        /'; }
  done
fi

line "Выпущенные сертификаты"
for v in $(docker volume ls --format '{{.Name}}' 2>/dev/null); do
  mp=$(docker volume inspect "$v" -f '{{.Mountpoint}}' 2>/dev/null)
  [ -d "$mp/live" ] || continue
  for d in "$mp"/live/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    if have openssl && [ -f "$d/fullchain.pem" ]; then
      echo "  $name:"
      openssl x509 -in "$d/fullchain.pem" -noout -subject -dates 2>/dev/null | sed 's/^/    /'
      openssl x509 -in "$d/fullchain.pem" -noout -ext subjectAltName 2>/dev/null | tail -1 | sed 's/^/    SAN: /'
    else
      echo "  $name"
    fi
  done
done

line "Как выкладывается основной сайт"
for f in deploy.sh Makefile makefile .github/workflows/*.yml *.sh; do
  [ -f "$f" ] && { echo "  ---- $f ----"; sed -n '1,80p' "$f"; }
done
echo "  Задания cron:"
for u in root deploy; do
  out=$(crontab -l -u "$u" 2>/dev/null)
  [ -n "$out" ] && { echo "    $u:"; echo "$out" | sed 's/^/      /'; }
done
echo "  Таймеры systemd:"
have systemctl && systemctl list-timers --all --no-pager 2>/dev/null \
  | grep -Ei 'docker|compose|deploy|aurea|watchtower' | sed 's/^/    /'
echo "  Вход в GHCR (печатаются только адреса реестров, не ключи):"
for f in /root/.docker/config.json /home/deploy/.docker/config.json; do
  [ -f "$f" ] && {
    printf '    %s: ' "$f"
    grep -o '"[a-z0-9.-]*\(ghcr\.io\|docker\.io\|registry[^"]*\)"' "$f" | tr '\n' ' '
    echo
  }
done

line "Пользователь deploy и ключи"
id deploy 2>/dev/null | sed 's/^/  /' || echo "  пользователя deploy нет"
for f in /home/deploy/.ssh/authorized_keys; do
  [ -f "$f" ] && {
    echo "  $f: $(grep -c . "$f" 2>/dev/null) строк(и)"
    awk '{print "    "$1"  ..."substr($3,1,24)}' "$f" 2>/dev/null
  }
done
echo "  Может ли deploy пользоваться docker: $(id -nG deploy 2>/dev/null | tr ' ' '\n' | grep -qx docker && echo да || echo НЕТ)"

line "Домен cenasaita.ru"
for host in cenasaita.ru www.cenasaita.ru; do
  echo "  $host:"
  getent ahostsv4 "$host" 2>/dev/null | awk '{print "    A    "$1}' | sort -u
  getent ahostsv6 "$host" 2>/dev/null | awk '{print "    AAAA "$1}' | sort -u
done
echo "  Встречается ли домен в конфигах стека:"
grep -rn 'cenasaita' . 2>/dev/null | head -10 | sed 's/^/    /' || echo "    нигде"

line "Место и версии"
df -hT / /var 2>/dev/null | sed 's/^/  /'
have docker && { docker --version | sed 's/^/  /'; docker compose version 2>/dev/null | sed 's/^/  /'; }
echo "  Свободные порты для квиза (проверка 8787–8790):"
for p in 8787 8788 8789 8790; do
  if ss -tlnH 2>/dev/null | awk -v x=":$p\$" '$4 ~ x' | grep -q .; then
    echo "    $p занят"
  else
    echo "    $p свободен"
  fi
done

echo
echo "Осмотр закончен. Ничего не изменено, ни один контейнер не тронут."
