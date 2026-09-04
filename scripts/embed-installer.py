#!/usr/bin/env python3
"""Подставляет base64 кода службы и описания юнита в шаблон установщика."""
import base64
import pathlib


def embed(path: str) -> str:
    raw = pathlib.Path(path).read_bytes()
    b64 = base64.b64encode(raw).decode()
    return "\n".join(b64[i:i + 76] for i in range(0, len(b64), 76))


tpl = pathlib.Path("server/install.template.sh").read_text(encoding="utf-8")
for token, source in (
    ("@@APP_PY_BASE64@@", "server/app.py"),
    ("@@UNIT_BASE64@@", "server/aurea-kviz.service"),
):
    if token not in tpl:
        raise SystemExit("в шаблоне нет плейсхолдера %s" % token)
    tpl = tpl.replace(token, embed(source))

pathlib.Path("server/install.sh").write_text(tpl, encoding="utf-8")
print("server/install.sh собран, %d байт" % len(tpl))
