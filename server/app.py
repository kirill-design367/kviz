#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AUREA · приёмник заявок с квиз-лендинга.

Только стандартная библиотека Python 3 — на сервере ничего не ставится через pip.
Слушает 127.0.0.1, наружу выставляется через отдельный конфиг nginx.

Главные свойства:
  * заявка пишется на диск с fsync ДО ответа браузеру — она не теряется,
    даже если Telegram недоступен;
  * api.telegram.org в России не отвечает по IPv4, но отвечает по IPv6 —
    сервис пробует оба пути, запоминает рабочий и периодически перепроверяет;
  * не ушедшие сообщения складываются в outbox и переотправляются с паузами.

Переменные окружения (файл /etc/aurea-kviz/kviz.env, права 600, читает systemd):
  AUREA_KVIZ_BOT_TOKEN        токен бота               (обязательно)
  AUREA_KVIZ_CHAT_ID          id получателя            (обязательно)
  AUREA_KVIZ_BIND             адрес, по умолчанию 127.0.0.1
  AUREA_KVIZ_PORT             порт, по умолчанию 8787
  AUREA_KVIZ_DATA_DIR         каталог данных, по умолчанию /var/lib/aurea-kviz
  AUREA_KVIZ_ALLOWED_ORIGINS  список Origin через запятую, по умолчанию *
  AUREA_KVIZ_IP_FAMILY        auto | ipv6 | ipv4, по умолчанию auto
  AUREA_KVIZ_RATE_PER_HOUR    заявок с одного адреса в час, по умолчанию 8
"""

import http.client
import http.server
import ipaddress
import json
import mimetypes
import logging
import os
import random
import re
import socket
import socketserver
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote, urlsplit

# --------------------------------------------------------------------------- #
# Конфигурация
# --------------------------------------------------------------------------- #

APP_NAME = "aurea-kviz"
VERSION = "1.0.0"

def env(*names, default=""):
    """Первое непустое значение из перечисленных переменных окружения.

    Токен и чат берутся из тех же переменных, что и у основного сайта
    (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID): заявки идут в тот же чат,
    и заводить второй набор ключей незачем. Имена AUREA_KVIZ_* остаются
    как явное переопределение, если однажды понадобится отдельный бот.
    """
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


BOT_TOKEN = env("AUREA_KVIZ_BOT_TOKEN", "TELEGRAM_BOT_TOKEN")
CHAT_ID = env("AUREA_KVIZ_CHAT_ID", "TELEGRAM_CHAT_ID")
BIND = env("AUREA_KVIZ_BIND", default="127.0.0.1")
PORT = int(env("AUREA_KVIZ_PORT", default="8787"))
DATA_DIR = env("AUREA_KVIZ_DATA_DIR", default="/var/lib/aurea-kviz")
# Каталог со статикой. Пусто — сервис работает только приёмником заявок,
# как раньше; задан — он же отдаёт сам сайт, и весь квиз живёт в одном
# контейнере: одна служба, один образ, один адрес для nginx.
STATIC_DIR = env("AUREA_KVIZ_STATIC_DIR")
ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in env("AUREA_KVIZ_ALLOWED_ORIGINS", default="*").split(",")
    if o.strip()
]
IP_FAMILY_PREF = env("AUREA_KVIZ_IP_FAMILY", default="auto").lower()
RATE_PER_HOUR = int(env("AUREA_KVIZ_RATE_PER_HOUR", default="8"))

TELEGRAM_HOST = "api.telegram.org"
LEADS_LOG = os.path.join(DATA_DIR, "leads.jsonl")
OUTBOX_DIR = os.path.join(DATA_DIR, "outbox")
SENT_DIR = os.path.join(DATA_DIR, "sent")
MAX_BODY = 16 * 1024
MSK = timezone(timedelta(hours=3))
# Адреса, от которых принимаются заголовки X-Real-IP и X-Forwarded-For.
# По умолчанию только локальная петля. В Docker впереди стоит соседний
# контейнер nginx с адресом из подсети сети compose, и его адрес меняется
# при пересоздании — поэтому запись принимается и подсетью: 172.16.0.0/12.
# Без этого весь трафик выглядел бы приходящим с одного адреса, и лимит
# в восемь заявок в час стал бы общим на всех посетителей сразу.
def _parse_proxies(raw):
    nets = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            nets.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            log.warning("Не понимаю адрес доверенного прокси: %s", item)
    return nets


def _trusted(peer):
    try:
        addr = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return any(addr in net for net in TRUSTED_PROXIES)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(APP_NAME)

TRUSTED_PROXIES = _parse_proxies(
    env("AUREA_KVIZ_TRUSTED_PROXIES", default="127.0.0.1,::1")
)


# --------------------------------------------------------------------------- #
# Транспорт до Telegram: принудительный выбор IPv6 / IPv4
# --------------------------------------------------------------------------- #

class FamilyHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS-соединение, которое ходит строго по указанному семейству адресов.

    В штатной библиотеке нет способа сказать «только IPv6»: socket.create_connection
    перебирает адреса в порядке getaddrinfo и на серверах в РФ первым обычно идёт
    IPv4-адрес api.telegram.org, который не отвечает. Соединение висит до таймаута,
    и бот выглядит сломанным. Здесь семейство задаётся явно.
    """

    def __init__(self, host, family, timeout, context):
        super().__init__(host, timeout=timeout, context=context)
        self._family = family
        # Адрес, на котором всё получилось, — для лога и для /api/health.
        self.used_address = None

    def connect(self):
        """Перебирает ВСЕ адреса семейства, и на TCP, и на TLS.

        Telegram отдаёт несколько адресов, и фильтрация в РФ работает не по
        всему списку сразу: один адрес принимает соединение и обрывает его
        на рукопожатии, соседний отвечает нормально. Раньше рукопожатие
        стояло ЗА циклом: первый же адрес, оборвавший TLS, ронял всю попытку,
        и остальные адреса не пробовались никогда. Теперь неудача на любой
        из двух фаз — повод взять следующий адрес.

        Порядок адресов перемешивается. Иначе каждая повторная попытка
        начиналась бы с того же самого адреса, и если закрыт именно он,
        очередь заявок стояла бы на одном и том же месте часами.
        """
        errors = []
        try:
            infos = socket.getaddrinfo(self.host, self.port, self._family, socket.SOCK_STREAM)
        except OSError as exc:
            raise OSError("не разрешается %s: %s" % (self.host, exc))
        if not infos:
            raise OSError("нет адресов для семейства %s" % self._family)
        infos = list(infos)
        random.shuffle(infos)
        for af, socktype, proto, _canon, sa in infos:
            address = sa[0]
            try:
                sock = socket.socket(af, socktype, proto)
            except OSError as exc:
                errors.append("%s: сокет не создался (%s)" % (address, exc))
                continue
            try:
                sock.settimeout(self.timeout)
                sock.connect(sa)
            except OSError as exc:
                errors.append("%s: TCP не прошёл (%s)" % (address, exc))
                sock.close()
                continue
            try:
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
            except OSError as exc:
                # Ровно тот случай, ради которого рукопожатие внутри цикла:
                # TCP приняли, а TLS оборвали. Идём на следующий адрес.
                errors.append("%s: TLS не прошёл (%s)" % (address, exc))
                try:
                    sock.close()
                except OSError:
                    pass
                continue
            self.used_address = address
            return
        raise OSError("; ".join(errors) or "не удалось подключиться")


class TelegramTransport:
    """Знает, по какому семейству адресов Telegram отвечает, и помнит это."""

    ORDER = {
        "auto": [socket.AF_INET6, socket.AF_INET],
        "ipv6": [socket.AF_INET6],
        "ipv4": [socket.AF_INET],
    }
    NAMES = {socket.AF_INET6: "IPv6", socket.AF_INET: "IPv4"}

    def __init__(self, token, preference="auto", timeout=12.0):
        self._token = token
        self._candidates = self.ORDER.get(preference, self.ORDER["auto"])
        self._timeout = timeout
        self._preferred = None
        self._ssl = ssl.create_default_context()
        self._lock = threading.Lock()
        # Последняя причина отказа и последний успех. Без них о том, почему
        # заявка не уходит, можно узнать только из журнала контейнера,
        # а он на чужом сервере не всегда под рукой.
        self.last_error = None
        self.last_probe = {}
        self.last_success_at = None
        self.last_address = None

    @property
    def working_path(self):
        if self._preferred is None:
            return "неизвестно"
        return self.NAMES.get(self._preferred, "неизвестно")

    def state(self):
        """Что показать в /api/health."""
        return {
            "telegram_path": self.working_path,
            "telegram_address": self.last_address,
            "telegram_last_error": self.last_error,
            "telegram_last_probe": self.last_probe,
            "telegram_last_success": self.last_success_at,
        }

    def probe(self):
        """Проверяет оба пути и пишет в лог, какой отвечает. Вызывается при старте."""
        results = {}
        for family in (socket.AF_INET6, socket.AF_INET):
            name = self.NAMES[family]
            try:
                infos = socket.getaddrinfo(TELEGRAM_HOST, 443, family, socket.SOCK_STREAM)
            except OSError as exc:
                results[name] = "нет адреса (%s)" % exc
                continue
            if not infos:
                results[name] = "нет адреса"
                continue
            address = infos[0][4][0]
            started = time.monotonic()
            conn = None
            try:
                # Проверяем полноценный HTTPS-запрос, а не только TCP-connect.
                # Фильтрация умеет принять TCP и оборвать соединение уже
                # на TLS: чистый connect() дал бы ложное «работает».
                conn = FamilyHTTPSConnection(TELEGRAM_HOST, family, 8.0, self._ssl)
                conn.request("GET", "/", headers={"User-Agent": "%s/%s" % (APP_NAME, VERSION)})
                status = conn.getresponse().status
                results[name] = "отвечает за %d мс (%s, HTTP %s)" % (
                    int((time.monotonic() - started) * 1000),
                    conn.used_address or address,
                    status,
                )
                with self._lock:
                    if self._preferred is None and family in self._candidates:
                        self._preferred = family
                        self.last_address = conn.used_address or address
            except Exception as exc:  # noqa: BLE001
                results[name] = "не отвечает (%s)" % exc
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:  # noqa: BLE001
                        pass
        for name, verdict in results.items():
            log.info("Telegram по %s: %s", name, verdict)
        self.last_probe = results
        if self._preferred is None:
            log.warning(
                "Ни один путь до %s не ответил при старте. "
                "Заявки будут сохраняться в outbox и переотправляться.",
                TELEGRAM_HOST,
            )
        else:
            log.info("Выбран путь до Telegram: %s", self.working_path)
        return results

    def _order(self):
        with self._lock:
            preferred = self._preferred
        if preferred is None:
            return list(self._candidates)
        return [preferred] + [f for f in self._candidates if f != preferred]

    def send_message(self, text):
        """Возвращает (True, None) либо (False, 'причина')."""
        if not self._token or not CHAT_ID:
            return False, "не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID"

        payload = json.dumps(
            {
                "chat_id": CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            }
        ).encode("utf-8")

        errors = []
        for family in self._order():
            name = self.NAMES[family]
            conn = None
            try:
                conn = FamilyHTTPSConnection(
                    TELEGRAM_HOST, family, self._timeout, self._ssl
                )
                conn.request(
                    "POST",
                    "/bot%s/sendMessage" % self._token,
                    body=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Content-Length": str(len(payload)),
                        "User-Agent": "%s/%s" % (APP_NAME, VERSION),
                    },
                )
                response = conn.getresponse()
                raw = response.read(64 * 1024)
                if response.status == 200:
                    with self._lock:
                        self._preferred = family
                        self.last_address = conn.used_address
                        self.last_error = None
                        self.last_success_at = datetime.now(timezone.utc).isoformat(
                            timespec="seconds"
                        )
                    return True, None
                # Токен/чат неверны — перебирать семейства бессмысленно.
                detail = _describe_telegram_error(response.status, raw)
                errors.append("%s: %s" % (name, detail))
                if response.status in (400, 401, 403, 404):
                    break
            except Exception as exc:  # noqa: BLE001 — наружу уходит текстом в лог
                errors.append("%s: %s" % (name, exc))
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:  # noqa: BLE001
                        pass
        reason = "; ".join(errors) or "неизвестная ошибка"
        with self._lock:
            self._preferred = None
            self.last_error = reason
        return False, reason


def _describe_telegram_error(status, raw):
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
        return "HTTP %s %s" % (status, data.get("description", ""))
    except Exception:  # noqa: BLE001
        return "HTTP %s" % status


# --------------------------------------------------------------------------- #
# Хранилище заявок
# --------------------------------------------------------------------------- #

def _fsync_dir(path):
    try:
        fd = os.open(path, os.O_DIRECTORY)
    except (AttributeError, OSError):
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class LeadStore:
    """Журнал всех заявок + очередь неотправленных.

    leads.jsonl — вечный журнал, туда пишется каждая заявка.
    outbox/     — по файлу на неотправленную заявку.
    sent/       — то, что в итоге ушло (чтобы outbox не рос и было видно историю).
    """

    def __init__(self, data_dir):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        for path in (data_dir, OUTBOX_DIR, SENT_DIR):
            os.makedirs(path, exist_ok=True)

    def append(self, lead):
        line = json.dumps(lead, ensure_ascii=False) + "\n"
        with self._lock:
            with open(LEADS_LOG, "a", encoding="utf-8") as handle:
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())

    def enqueue(self, lead):
        path = os.path.join(OUTBOX_DIR, "%s.json" % lead["id"])
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(lead, handle, ensure_ascii=False, indent=1)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        _fsync_dir(OUTBOX_DIR)

    def pending(self):
        try:
            names = sorted(n for n in os.listdir(OUTBOX_DIR) if n.endswith(".json"))
        except FileNotFoundError:
            return []
        out = []
        for name in names:
            try:
                with open(os.path.join(OUTBOX_DIR, name), encoding="utf-8") as handle:
                    out.append(json.load(handle))
            except (OSError, ValueError) as exc:
                log.error("Не читается %s: %s", name, exc)
        return out

    def mark_sent(self, lead_id):
        src = os.path.join(OUTBOX_DIR, "%s.json" % lead_id)
        dst = os.path.join(SENT_DIR, "%s.json" % lead_id)
        try:
            os.replace(src, dst)
        except FileNotFoundError:
            pass

    def pending_count(self):
        try:
            return sum(1 for n in os.listdir(OUTBOX_DIR) if n.endswith(".json"))
        except FileNotFoundError:
            return 0


# --------------------------------------------------------------------------- #
# Разбор и проверка заявки
# --------------------------------------------------------------------------- #

PHONE_DIGITS = re.compile(r"\d")
NAME_OK = re.compile(r"^[\w\s\-'’.]{2,60}$", re.UNICODE)
CHANNELS = {"telegram": "Telegram", "call": "Звонок"}


PHONE_ALLOWED = re.compile(r"^[\d\s+()\-.]+$")


def accept_phone(raw):
    """Принимает номер ровно в том виде, в каком его напечатали.

    Ничего не переставляем и не дописываем: человек ввёл как ему удобно,
    и в заявке владелец увидит его же запись. Проверяем только, что это
    вообще похоже на номер — от десяти до пятнадцати цифр и без букв.
    Возвращает (как_напечатано, только_цифры) либо (None, None).
    """
    value = (raw or "").strip()
    if not value or len(value) > 40:
        return None, None
    if not PHONE_ALLOWED.match(value):
        return None, None
    digits = "".join(PHONE_DIGITS.findall(value))
    if not 10 <= len(digits) <= 15:
        return None, None
    return value, digits


# Ник в Telegram: 5–32 знака, латиница, цифры и подчёркивание, начинается
# с буквы. Пишут по-разному — «@name», «name», «t.me/name», ссылкой целиком.
TELEGRAM_NICK = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
TELEGRAM_PREFIX = re.compile(r"^(https?://)?(www\.)?t(elegram)?\.me/", re.IGNORECASE)


def accept_telegram(raw):
    """Принимает ник ровно в том виде, в каком его напечатали.

    Возвращает (как_напечатано, только_ник) либо (None, None). Сам ник
    нужен для ссылки в сообщении владельцу: по нему открывается диалог.
    """
    value = (raw or "").strip()
    if not value or len(value) > 80:
        return None, None
    nick = TELEGRAM_PREFIX.sub("", value).lstrip("@")
    nick = re.split(r"[/?#]", nick, 1)[0].strip()
    if not TELEGRAM_NICK.match(nick):
        return None, None
    return value, nick


def clean_text(value, limit):
    if not isinstance(value, str):
        return ""
    return value.replace("\r", " ").replace("\n", " ").strip()[:limit]


def parse_lead(payload, remote_ip, user_agent):
    errors = {}

    name = clean_text(payload.get("name"), 60)
    if len(name) < 2 or not NAME_OK.match(name):
        errors["name"] = "Имя не похоже на имя"

    channel = payload.get("channel")
    if channel not in CHANNELS:
        errors["channel"] = "Неизвестный способ связи"

    # Что спрашивали на экране, то и проверяем. Выбрал Telegram — прислал
    # ник, и телефона у него нет; выбрал звонок — прислал номер.
    phone = phone_digits = None
    telegram = telegram_nick = None
    if channel == "telegram":
        telegram, telegram_nick = accept_telegram(payload.get("telegram"))
        if not telegram:
            errors["telegram"] = "Это не похоже на ник в Telegram"
    else:
        phone, phone_digits = accept_phone(payload.get("phone"))
        if not phone:
            errors["phone"] = "Это не похоже на номер телефона"

    if clean_text(payload.get("company"), 100):
        # Ловушка для ботов: поле скрыто от человека и всегда должно быть пустым.
        errors["company"] = "spam"

    answers = payload.get("answers")
    if not isinstance(answers, list):
        answers = []
    safe_answers = []
    for item in answers[:12]:
        if not isinstance(item, dict):
            continue
        safe_answers.append(
            {
                "question": clean_text(item.get("question"), 120),
                "answer": clean_text(item.get("answer"), 120),
            }
        )

    price = payload.get("price") if isinstance(payload.get("price"), dict) else {}
    low = price.get("low")
    high = price.get("high")
    if not isinstance(low, (int, float)) or not 0 <= low <= 10_000_000:
        low = None
    if not isinstance(high, (int, float)) or not 0 <= high <= 10_000_000:
        high = None

    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    safe_source = {
        key: clean_text(source.get(key), 120)
        for key in ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "page")
        if source.get(key)
    }

    lead = {
        "id": uuid.uuid4().hex[:12],
        "received_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "name": name,
        # Ровно то, что напечатал человек. Заполнено то поле, которое он видел.
        "phone": phone,
        # Только цифры — нужны для ссылки, в сообщении не показываются.
        "phone_digits": phone_digits,
        "telegram": telegram,
        "telegram_nick": telegram_nick,
        "contact": telegram or phone or "—",
        "channel": channel,
        "channel_label": CHANNELS.get(channel, "—"),
        "answers": safe_answers,
        "price": {"low": low, "high": high},
        "source": safe_source,
        "client_id": clean_text(payload.get("clientId"), 64),
        "remote_ip": remote_ip,
        "user_agent": clean_text(user_agent, 200),
    }
    return lead, errors


def escape_html(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def format_money(value):
    if value is None:
        return "—"
    return "{:,}".format(int(round(value))).replace(",", " ") + " ₽"


def render_message(lead):
    received = datetime.fromisoformat(lead["received_at"]).astimezone(MSK)
    lines = [
        "<b>Заявка с квиза — cenasaita.ru</b>",
        "",
        "<b>%s</b>" % escape_html(lead["name"]),
        "%s · %s" % (escape_html(lead.get("contact") or "—"), escape_html(lead["channel_label"])),
    ]
    if lead.get("telegram_nick"):
        lines.append("Написать: https://t.me/%s" % lead["telegram_nick"])
    elif lead["channel"] == "telegram" and lead.get("phone_digits"):
        # Заявки старого образца: ника не было, оставался только номер.
        lines.append("Написать: https://t.me/+%s" % lead["phone_digits"])

    low = lead["price"].get("low")
    high = lead["price"].get("high")
    if low and high:
        lines += ["", "Вилка на экране: <b>%s — %s</b>" % (format_money(low), format_money(high))]
    else:
        # Бюджет без верхней границы: вилки человек не видел, и говорить
        # с ним о числе, которого не было на экране, нельзя.
        lines += ["", "Вилки на экране не было: бюджет назван без потолка."]

    if lead["answers"]:
        lines.append("")
        for index, item in enumerate(lead["answers"], start=1):
            lines.append(
                "%d. %s — <b>%s</b>"
                % (index, escape_html(item["question"]), escape_html(item["answer"]))
            )

    source = lead.get("source") or {}
    if source:
        lines.append("")
        campaign = " / ".join(
            escape_html(source[key])
            for key in ("utm_source", "utm_medium", "utm_campaign")
            if source.get(key)
        )
        if campaign:
            lines.append("Кампания: %s" % campaign)
        if source.get("utm_term"):
            lines.append("Запрос: %s" % escape_html(source["utm_term"]))
        if source.get("referrer"):
            lines.append("Переход с: %s" % escape_html(source["referrer"]))

    lines += ["", "%s МСК · №%s" % (received.strftime("%d.%m.%Y %H:%M"), lead["id"])]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Ограничение частоты
# --------------------------------------------------------------------------- #

class RateLimiter:
    def __init__(self, per_hour):
        self._per_hour = max(1, per_hour)
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        cutoff = now - 3600
        with self._lock:
            bucket = [t for t in self._hits.get(key, []) if t > cutoff]
            if len(bucket) >= self._per_hour:
                self._hits[key] = bucket
                return False
            bucket.append(now)
            self._hits[key] = bucket
            if len(self._hits) > 5000:
                self._hits = {
                    k: v for k, v in self._hits.items() if v and v[-1] > cutoff
                }
            return True


# --------------------------------------------------------------------------- #
# Фоновая переотправка
# --------------------------------------------------------------------------- #

class OutboxWorker(threading.Thread):
    """Раз в минуту пытается доставить всё, что лежит в outbox."""

    daemon = True

    def __init__(self, store, transport, interval=60.0):
        super().__init__(name="outbox")
        self._store = store
        self._transport = transport
        self._interval = interval
        self._wake = threading.Event()
        self._stop = threading.Event()

    def poke(self):
        self._wake.set()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def run(self):
        while not self._stop.is_set():
            self._wake.wait(self._interval)
            self._wake.clear()
            if self._stop.is_set():
                return
            pending = self._store.pending()
            if not pending:
                continue
            log.info("В очереди %d заявок, пробую отправить", len(pending))
            for lead in pending:
                ok, reason = self._transport.send_message(render_message(lead))
                if ok:
                    self._store.mark_sent(lead["id"])
                    log.info("Заявка %s доставлена из очереди", lead["id"])
                else:
                    log.warning("Заявка %s всё ещё не уходит: %s", lead["id"], reason)
                    break  # смысла долбить остальные нет — путь всё равно закрыт


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "%s/%s" % (APP_NAME, VERSION)
    protocol_version = "HTTP/1.1"

    # --- служебное ---------------------------------------------------------- #

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def _origin_header(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if "*" in ALLOWED_ORIGINS:
            return origin or "*"
        if origin in ALLOWED_ORIGINS:
            return origin
        return ""

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        allow = self._origin_header()
        if allow:
            self.send_header("Access-Control-Allow-Origin", allow)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _client_ip(self):
        """Адрес, которому можно верить.

        X-Forwarded-For брать ПЕРВЫМ элементом нельзя: nginx с
        $proxy_add_x_forwarded_for дописывает настоящий адрес в КОНЕЦ, а начало
        списка приходит от браузера и подделывается одной строкой — ограничение
        частоты обходилось бы тривиально. X-Real-IP ставит сам nginx, поэтому
        он в приоритете, а из X-Forwarded-For берётся последний элемент.
        """
        peer = self.client_address[0]
        # Заголовкам верим, только если запрос пришёл от локального nginx.
        # Иначе любой, кто достучится до порта напрямую, назовётся кем угодно.
        if not _trusted(peer):
            return peer
        real = (self.headers.get("X-Real-IP") or "").strip()
        if real:
            return real[:45]
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[-1].strip()[:45]
        return peer

    def _drain(self):
        """Дочитать тело запроса.

        При HTTP/1.1 с keep-alive ответ без вычитанного тела оставляет байты
        в сокете, и они разбираются как начало следующего запроса — сыплются
        необъяснимые 400.
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        remaining = min(max(length, 0), MAX_BODY * 4)
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 65536))
            if not chunk:
                break
            remaining -= len(chunk)

    # --- методы ------------------------------------------------------------- #

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        allow = self._origin_header()
        if allow:
            self.send_header("Access-Control-Allow-Origin", allow)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- статика ------------------------------------------------------------ #

    def _static_path(self, url_path):
        """Файл под STATIC_DIR или None.

        Экспорт Next собран с trailingSlash, поэтому страница лежит
        в «каталог/index.html». Выход за пределы каталога исключён
        сравнением уже разрешённых путей: одной проверки на «..» мало —
        её обходят через кодирование и символические ссылки.
        """
        if not STATIC_DIR:
            return None
        path = unquote(urlsplit(url_path).path)
        if "\0" in path:
            return None
        root = os.path.realpath(STATIC_DIR)
        target = os.path.realpath(os.path.join(root, path.lstrip("/")))
        if target != root and not target.startswith(root + os.sep):
            return None
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        return target if os.path.isfile(target) else None

    def _static_headers(self, url_path, ctype, length, encoding=None):
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        # Имена файлов сборки содержат хеш содержимого, шрифты неизменны —
        # их можно держать в кеше сколько угодно. HTML обязан проверяться,
        # иначе после выкладки человек увидит старую страницу.
        if url_path.startswith("/_next/static/") or url_path.startswith("/fonts/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")

    def _serve_static(self, url_path, head_only=False):
        """Отдаёт файл. Возвращает False, если отдавать нечего."""
        target = self._static_path(url_path)
        status = 200
        if target is None:
            fallback = os.path.join(os.path.realpath(STATIC_DIR), "404.html") if STATIC_DIR else ""
            if not fallback or not os.path.isfile(fallback):
                return False
            target, status = fallback, 404

        ctype, _ = mimetypes.guess_type(target)
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or ctype in (
            "application/javascript",
            "application/json",
            "image/svg+xml",
        ):
            ctype += "; charset=utf-8"

        # Сжатые копии кладутся рядом на сборке образа: nginx впереди чужой,
        # и полагаться на то, что он включит gzip проксированному ответу,
        # нельзя. Отдаём готовое, ничего не пережимая в запросе.
        encoding = None
        packed = target + ".gz"
        if "gzip" in self.headers.get("Accept-Encoding", "") and os.path.isfile(packed):
            target, encoding = packed, "gzip"

        try:
            size = os.path.getsize(target)
            self.send_response(status)
            self._static_headers(url_path, ctype, size, encoding)
            self.end_headers()
            if head_only:
                return True
            with open(target, "rb") as fh:
                while True:
                    chunk = fh.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError:
            return False
        return True

    def do_HEAD(self):  # noqa: N802
        if STATIC_DIR and not self.path.startswith("/api/") and self._serve_static(self.path, True):
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") in ("/api/health", "/health"):
            self._send(
                200,
                {
                    "ok": True,
                    "service": APP_NAME,
                    "version": VERSION,
                    "pending": self.server.store.pending_count(),
                    "configured": bool(BOT_TOKEN and CHAT_ID),
                    **self.server.transport.state(),
                },
            )
            return
        if STATIC_DIR and not self.path.startswith("/api/") and self._serve_static(self.path):
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") not in ("/api/lead", "/lead"):
            self._drain()
            self._send(404, {"ok": False, "error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._drain()
            self._send(413, {"ok": False, "error": "bad_size"})
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._send(400, {"ok": False, "error": "bad_json"})
            return
        if not isinstance(payload, dict):
            self._send(400, {"ok": False, "error": "bad_json"})
            return

        ip = self._client_ip()
        if not self.server.limiter.allow(ip):
            log.warning("Превышен лимит заявок с %s", ip)
            self._send(429, {"ok": False, "error": "rate_limited"})
            return

        lead, errors = parse_lead(payload, ip, self.headers.get("User-Agent", ""))
        if errors:
            if errors.get("company"):
                # Ловушка сработала: боту отвечаем как будто всё хорошо.
                log.warning("Ловушка сработала, заявка с %s отброшена", ip)
                self._send(200, {"ok": True, "id": "-"})
                return
            self._send(422, {"ok": False, "error": "invalid", "fields": errors})
            return

        # Сначала на диск — потом всё остальное. Заявка не теряется.
        try:
            self.server.store.append(lead)
            self.server.store.enqueue(lead)
        except OSError as exc:
            log.exception("Не удалось сохранить заявку: %s", exc)
            self._send(500, {"ok": False, "error": "storage"})
            return

        # Отвечаем сразу. Отправку в Telegram делает фоновый поток: если оба
        # пути до api.telegram.org лежат, синхронная отправка держала бы
        # посетителя до двух таймаутов подряд, а nginx успел бы отвалиться
        # по proxy_read_timeout. Заявка уже на диске, терять нечего.
        log.info("Заявка %s принята", lead["id"])
        self._send(200, {"ok": True, "id": lead["id"]})
        self.server.outbox.poke()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    address_family = socket.AF_INET6 if ":" in BIND else socket.AF_INET


def main():
    if not BOT_TOKEN or not CHAT_ID:
        log.warning(
            "Токен и чат не заданы (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). "
            "Сервис поднимется и будет сохранять заявки, но отправлять их не сможет."
        )

    store = LeadStore(DATA_DIR)
    transport = TelegramTransport(BOT_TOKEN, IP_FAMILY_PREF)
    outbox = OutboxWorker(store, transport)

    # Сокет поднимается ПЕРВЫМ делом. Проба обоих путей до Telegram занимает
    # секунды; если делать её до bind, systemd при Type=simple уже считает
    # службу запущенной, а nginx в это окно отдаёт 502.
    server = Server((BIND, PORT), Handler)
    server.store = store
    server.transport = transport
    server.outbox = outbox
    server.limiter = RateLimiter(RATE_PER_HOUR)
    log.info(
        "%s %s слушает %s:%s, статика: %s",
        APP_NAME,
        VERSION,
        BIND,
        PORT,
        STATIC_DIR or "не отдаётся",
    )

    def warm_up():
        """Ищет рабочий путь до Telegram и не бросает попыток.

        Фильтрация в РФ работает не постоянно: тот же адрес, что сейчас
        не отвечает, через десять минут отвечает за 50 мс. Раньше проба
        сдавалась после четырёх попыток, и контейнер до перезапуска считал
        путь закрытым — а /api/health до перезапуска показывал «неизвестно»,
        даже когда связь давно вернулась. Теперь проба повторяется, пока
        путь не найден: пауза растёт до десяти минут и на этом замирает.

        Заявки от этого не зависят: они лежат на диске, а очередь и так
        перебирает семейства каждую минуту. Но пустая очередь сама по себе
        путь не нащупает, и без этого цикла первая же заявка после долгого
        затишья уходила бы вслепую.
        """
        pause = 0
        while True:
            if pause:
                time.sleep(pause)
            transport.probe()
            outbox.poke()
            if transport.working_path != "неизвестно":
                return
            pause = min(600, pause * 2 or 30)

    outbox.start()
    threading.Thread(target=warm_up, name="probe", daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        outbox.stop()
        server.server_close()
        log.info("Остановлен")


if __name__ == "__main__":
    main()
