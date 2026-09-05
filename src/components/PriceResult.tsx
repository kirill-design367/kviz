'use client';

import { useEffect, useRef } from 'react';
import { formatMoney, type PriceEstimate } from '@/lib/pricing';

type Props = {
  price: PriceEstimate;
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

  if (price.kind === 'discuss') {
    /* Числа нет и придумывать его не из чего. На месте вилки — одна строка,
       набранная крупнее основного текста: блок должен весить в кадре столько
       же, сколько весила бы цифра, иначе экран проваливается. */
    return (
      <div ref={root}>
        {/* Надстрочной подписи здесь нет намеренно. Строка длиннее цифры
            и занимает три строки на узком экране: с подписью экран перестаёт
            помещаться на 360×640, а без неё сама фраза встаёт на место цифры
            и читается как ответ на вопрос о стоимости. */}
        <p data-appear className="text-[1.05rem] leading-[1.4] text-ink lg:text-[1.35rem]">
          {price.note}
        </p>
      </div>
    );
  }

  return (
    <div ref={root}>
      <p
        data-appear
        className="text-[0.78rem] uppercase tracking-[0.16em] text-ink-faint lg:text-[0.85rem]"
      >
        Ориентировочная стоимость
      </p>

      <p
        data-appear
        className="figure mt-2 text-[1.85rem] leading-[1.04] tracking-[-0.015em] xs:text-[2.15rem] sm:text-[2.6rem] lg:mt-3 lg:text-[3.4rem] xl:text-[3.8rem]"
      >
        <span className="whitespace-nowrap">{formatMoney(price.low)}</span>
        <span aria-hidden className="mx-2 text-ink-faint lg:mx-3">
          —
        </span>
        <span className="whitespace-nowrap">
          {formatMoney(price.high)} <span className="text-ink-faint">₽</span>
        </span>
      </p>
    </div>
  );
}
