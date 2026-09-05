"""Проверка пути до api.telegram.org изнутри контейнера. Ничего не меняет.

Печатает: какие адреса вернул резолвер, и по каждому — доходит ли
TCP-соединение и поднимается ли TLS. Именно TLS: фильтрация умеет принять
TCP и оборвать соединение уже на рукопожатии, и один connect() дал бы
ложное «работает».
"""
import socket
import ssl
import time

HOST = "api.telegram.org"
FAMILIES = ((socket.AF_INET, "IPv4"), (socket.AF_INET6, "IPv6"))

print("резолвер:")
try:
    with open("/etc/resolv.conf", encoding="utf-8") as fh:
        for line in fh:
            if line.strip() and not line.startswith("#"):
                print("   ", line.rstrip())
except OSError as exc:
    print("    не прочитался:", exc)

ctx = ssl.create_default_context()
for family, name in FAMILIES:
    try:
        infos = socket.getaddrinfo(HOST, 443, family, socket.SOCK_STREAM)
        addresses = sorted({info[4][0] for info in infos})
    except OSError as exc:
        print("%s: резолв не удался — %s" % (name, exc))
        continue
    print("%s: адреса — %s" % (name, ", ".join(addresses) or "нет"))
    for address in addresses:
        started = time.monotonic()
        sock = None
        try:
            sock = socket.socket(family, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect((address, 443))
            tcp = int((time.monotonic() - started) * 1000)
            wrapped = ctx.wrap_socket(sock, server_hostname=HOST)
            wrapped.close()
            sock = None
            print("    %-40s TCP %d мс, TLS поднялся" % (address, tcp))
        except Exception as exc:  # noqa: BLE001
            print(
                "    %-40s НЕТ: %s (%d мс)"
                % (address, exc, int((time.monotonic() - started) * 1000))
            )
        finally:
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
