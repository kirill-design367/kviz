'use client';

import { useEffect, useRef } from 'react';
import { formatMoney, type PriceRange } from '@/lib/pricing';

type Props = {
  price: PriceRange;
  reducedMotion: boolean;
};

/**
 * Вилка показывается сразу, как только пройден седьмой вопрос: без условий,
 * без формы перед ней и без анимации «идёт расчёт». Число уже посчитано
 * в том же кадре, в котором отрисован экран.
 */
export function PriceResult({ price, reducedMotion }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion || !root.current) return;
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;

    import('gsap').then(({ gsap }) => {
      if (cancelled || !root.current) return;
      ctx = gsap.context(() => {
        gsap.from('[data-appear]', {
          opacity: 0,
          y: 16,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.08,
        });
      }, root);
    });

    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, [reducedMotion]);

  return (
    <div ref={root}>
      <p
        data-appear
        className="mb-6 flex items-center gap-3 text-[0.8rem] uppercase tracking-[0.16em] text-on-ink-soft"
      >
        <span aria-hidden className="inline-block h-px w-8 bg-on-ink-soft/50" />
        Вилка по вашим ответам
      </p>

      <p
        data-appear
        className="figure min-h-[2.7em] text-[2.6rem] leading-[1.02] tracking-[-0.015em] xs:text-[3.1rem] sm:min-h-[1.1em] sm:text-[4.2rem] md:text-[5.4rem]"
      >
        <span className="whitespace-nowrap">{formatMoney(price.low)}</span>
        <span aria-hidden className="mx-2 text-on-ink-soft md:mx-4">
          —
        </span>
        <span className="whitespace-nowrap">
          {formatMoney(price.high)} <span className="text-on-ink-soft">₽</span>
        </span>
      </p>

      <p data-appear className="mt-6 max-w-column text-[0.98rem] leading-relaxed text-on-ink-soft">
        Нижняя граница — работа ровно по вашим ответам. Верхняя — если по ходу
        добавятся детали.
      </p>

      <p
        data-appear
        className="mt-10 text-[0.78rem] uppercase tracking-[0.14em] text-on-ink-soft md:mt-12"
      >
        Что повлияло на диапазон
      </p>

      <dl
        data-appear
        className="mt-4 grid max-w-[38rem] gap-px overflow-hidden border-y border-on-ink-soft/25 md:grid-cols-3"
      >
        {price.factors.map((factor) => (
          <div key={factor.label} className="border-b border-on-ink-soft/25 py-4 md:border-b-0">
            <dt className="text-[0.78rem] uppercase tracking-[0.14em] text-on-ink-soft">
              {factor.label}
            </dt>
            <dd className="mt-1.5 text-[1rem] leading-snug">{factor.value}</dd>
          </div>
        ))}
      </dl>

      <p data-appear className="mt-7 max-w-column text-[0.95rem] leading-relaxed text-on-ink-soft">
        Ответ про бюджет в расчёт не входит — иначе вы увидели бы ровно ту цифру,
        которую сами и выбрали. Точную сумму назову, когда разберём детали.
      </p>
    </div>
  );
}
