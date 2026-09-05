# Квиз-лендинг AUREA — один образ, одна служба.
#
# Внутри и статика, и приёмник заявок: сайт и /api/lead отвечают на одном
# домене, поэтому ни CORS, ни второго контейнера не нужно.
#
# Базовые образы тянутся ЗДЕСЬ, при сборке в GitHub Actions. На сервере
# docker.io недоступен, но туда уезжает уже готовый образ из GHCR —
# базовых образов он не докачивает.

# --- сборка статики --------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /src

# Слой зависимостей отдельно: пока package-lock не менялся, он берётся из кеша.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Префикса нет: на своём домене сайт лежит в корне.
# Адрес приёмника заявок тоже не задаётся — по умолчанию это свой же /api/lead.
ARG NEXT_PUBLIC_SITE_URL=https://cenasaita.ru
ARG NEXT_PUBLIC_YM_ID=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_YM_ID=$NEXT_PUBLIC_YM_ID

RUN npm run build

# Сжатые копии кладутся рядом с оригиналом: nginx впереди чужой, и полагаться
# на то, что он включит gzip для проксированного ответа, нельзя. Сжимаем один
# раз на сборке, в запросе ничего не пережимается.
RUN find out -type f \
      \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.svg' \
         -o -name '*.json' -o -name '*.txt' -o -name '*.xml' \) \
      -size +1k -exec gzip -9 -k {} \;

# --- рабочий образ ---------------------------------------------------------
FROM python:3.12-alpine

# Приёмник заявок написан на голой стандартной библиотеке: ни pip, ни колёс.
LABEL org.opencontainers.image.title="AUREA · квиз-лендинг" \
      org.opencontainers.image.source="https://github.com/kirill-design367/kviz"

ENV PYTHONUNBUFFERED=1 \
    AUREA_KVIZ_BIND=0.0.0.0 \
    AUREA_KVIZ_PORT=8787 \
    AUREA_KVIZ_STATIC_DIR=/srv/site \
    AUREA_KVIZ_DATA_DIR=/var/lib/aurea-kviz

RUN addgroup -g 10001 -S kviz \
 && adduser -u 10001 -S -G kviz -h /srv -s /sbin/nologin kviz \
 && install -d -o kviz -g kviz -m 0750 /var/lib/aurea-kviz

COPY --from=build --chown=root:root /src/out /srv/site
COPY --chown=root:root server/app.py /srv/app.py

USER kviz
WORKDIR /srv
EXPOSE 8787

# Заявка сначала ложится на диск и только потом уходит в Telegram, поэтому
# «здоров» здесь значит «принимает и не потеряет», а не «дозвонился до бота».
# Проверка стучится по тому же адресу, на котором служба слушает. Когда
# контейнер живёт в сети хоста, он слушает не 0.0.0.0, а один конкретный
# адрес моста, и проверка по 127.0.0.1 показывала бы «болен» на здоровой
# службе — а выкладка по такому «болен» откатывается.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD H="${AUREA_KVIZ_BIND}"; [ "$H" = "0.0.0.0" ] || [ -z "$H" ] && H=127.0.0.1; \
      wget -qO- "http://${H}:${AUREA_KVIZ_PORT}/api/health" >/dev/null || exit 1

CMD ["python3", "/srv/app.py"]
