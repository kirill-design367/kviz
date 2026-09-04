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
 *
 * Блок живёт в одном кадре с формой, поэтому набран плотно: всё, что можно
 * сказать короче, сказано короче, а объяснения не отталкивают поля вниз.
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
          stagger: 0.07,
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
        className="text-[0.78rem] uppercase tracking-[0.16em] text-on-ink-soft"
      >
        Вилка по вашим ответам
      </p>

      <p
        data-appear
        className="figure mt-2.5 text-[1.95rem] leading-[1.04] tracking-[-0.015em] xs:text-[2.3rem] sm:text-[3.2rem] lg:text-[3rem] xl:text-[3.5rem]"
      >
        <span className="whitespace-nowrap">{formatMoney(price.low)}</span>
        <span aria-hidden className="mx-2 text-on-ink-soft lg:mx-3">
          —
        </span>
        <span className="whitespace-nowrap">
          {formatMoney(price.high)} <span className="text-on-ink-soft">₽</span>
        </span>
      </p>

      {price.caveat ? (
        <p
          data-appear
          className="mt-3 max-w-[34rem] border-l-2 border-gold-soft/60 pl-3 text-[0.85rem] leading-snug text-on-ink-soft"
        >
          {price.caveat}
        </p>
      ) : null}

    </div>
  );
}
