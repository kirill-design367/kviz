import sys, glob, os
from fontTools.ttLib import TTFont

RU_UPPER = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
RU_LOWER = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
DIGITS   = "0123456789"
PUNCT    = "«»—–…№₽()%,.:;?!/-+"
LAT      = "AUREA"

GROUPS = [("Кириллица заглавные", RU_UPPER), ("Кириллица строчные", RU_LOWER),
          ("Цифры", DIGITS), ("Пунктуация/символы", PUNCT), ("Латиница AUREA", LAT)]

for path in sorted(glob.glob(sys.argv[1] + "/*.ttf")):
    f = TTFont(path, lazy=True)
    cmap = set()
    for t in f["cmap"].tables:
        cmap |= set(t.cmap.keys())
    name = os.path.basename(path)
    ok = True
    lines = []
    for label, chars in GROUPS:
        missing = [c for c in chars if ord(c) not in cmap]
        if missing:
            ok = False
        lines.append(f"    {label:22s} {len(chars)-len(missing)}/{len(chars)}" + (f"  ОТСУТСТВУЮТ: {''.join(missing)}" if missing else "  ✓"))
    # count of all cyrillic codepoints present in U+0400..U+04FF
    cyr_block = sum(1 for cp in range(0x0400, 0x0500) if cp in cmap)
    axes = ""
    if "fvar" in f:
        axes = ", ".join(f"{a.axisTag} {a.minValue}..{a.maxValue}" for a in f["fvar"].axes)
    print(f"{name}  [{'OK' if ok else 'НЕПОЛНЫЙ'}]  глифов в cmap: {len(cmap)}, из блока Cyrillic U+0400–04FF: {cyr_block}/256" + (f", оси: {axes}" if axes else ""))
    print("\n".join(lines))
    print()
