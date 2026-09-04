#!/usr/bin/env python3
"""Проверка контраста по WCAG 2.1 для палитры проекта."""
def lum(h):
    h = h.lstrip('#')
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

PAIRS = [
    ("ink / paper",            "#14130F", "#F3F0EA", 4.5),
    ("ink-soft / paper",       "#5A564C", "#F3F0EA", 4.5),
    ("ink-faint / paper",      "#6E685C", "#F3F0EA", 4.5),
    ("gold / paper",           "#7E5F16", "#F3F0EA", 4.5),
    ("paper / ink (кнопка)",   "#F3F0EA", "#14130F", 4.5),
    ("ink / paper-raised",     "#14130F", "#FBFAF7", 4.5),
    ("ink-soft / paper-raised","#5A564C", "#FBFAF7", 4.5),
    ("ink / gold-soft",        "#14130F", "#F2E8D0", 4.5),
    ("line / paper (граница)", "#CFC7B6", "#F3F0EA", 1.4),
    ("error / paper",          "#A03024", "#F3F0EA", 4.5),
]
worst_ok = True
for name, fg, bg, need in PAIRS:
    r = ratio(fg, bg)
    good = r >= need
    worst_ok = worst_ok and good
    print("%-26s %s на %s = %5.2f:1  нужно %.1f  %s" % (name, fg, bg, r, need, "OK" if good else "МАЛО"))
print("\nИтог:", "вся палитра проходит" if worst_ok else "есть пары ниже нормы")
