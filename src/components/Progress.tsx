'use client';

import { useEffect, useRef } from 'react';

type Props = {
  current: number;
  total: number;
  reducedMotion: boolean;
};

export function Progress({ current, total, reducedMotion }: Props) {
  const fill = useRef<HTMLDivElement>(null);
  // Считаем текущий вопрос уже начатым: на первом экране полоса не должна
  // быть пустой, иначе кажется, что ничего не происходит.
  const ratio = Math.min(1, Math.max(0, (current + 1) / total));

  useEffect(() => {
    const node = fill.current;
    if (!node) return;
    if (reducedMotion) {
      node.style.transform = `scaleX(${ratio})`;
      return;
    }
    let cancelled = false;
    import('gsap').then(({ gsap }) => {
      if (cancelled || !fill.current) return;
      gsap.to(fill.current, {
        scaleX: ratio,
        duration: 0.55,
        ease: 'power3.out',
        overwrite: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [ratio, reducedMotion]);

  return (
    <div className="select-none">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[0.8rem] uppercase tracking-[0.16em] text-ink-faint">
          Вопрос {Math.min(current + 1, total)} из {total}
        </span>
        <span className="figure text-[0.95rem] text-ink-faint" aria-hidden>
          {String(Math.min(current + 1, total)).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>
      <div
        className="h-[2px] w-full bg-line-soft"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-label={`Пройдено вопросов: ${current} из ${total}`}
      >
        <div
          ref={fill}
          className="h-[2px] w-full origin-left bg-ink will-change-transform"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </div>
  );
}
