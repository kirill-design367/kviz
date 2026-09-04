#!/usr/bin/env bash
# Собирает самодостаточный server/install.sh: шаблон + встроенные app.py
# и описание службы. Источники правды — server/app.py и
# server/aurea-kviz.service; install.sh производный, править его не надо.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile server/app.py
find server -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
python3 scripts/embed-installer.py
bash -n server/install.sh
chmod +x server/install.sh server/survey.sh
echo "синтаксис install.sh в порядке"
