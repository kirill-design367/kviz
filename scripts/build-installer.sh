#!/usr/bin/env bash
# Собирает самодостаточный server/install.sh: шаблон + встроенный app.py.
# app.py остаётся единственным источником правды, установщик — производный файл.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile server/app.py
find server -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
python3 - <<'PY'
import base64, pathlib
app = pathlib.Path('server/app.py').read_bytes()
b64 = base64.b64encode(app).decode()
wrapped = '\n'.join(b64[i:i+76] for i in range(0, len(b64), 76))
tpl = pathlib.Path('server/install.template.sh').read_text(encoding='utf-8')
assert '@@APP_PY_BASE64@@' in tpl, 'в шаблоне нет плейсхолдера'
out = tpl.replace('@@APP_PY_BASE64@@', wrapped)
pathlib.Path('server/install.sh').write_text(out, encoding='utf-8')
print('server/install.sh собран, %d байт' % len(out))
PY
bash -n server/install.sh
chmod +x server/install.sh server/survey.sh
