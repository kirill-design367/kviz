'use client';

import { useEffect, useRef } from 'react';
import { Wordmark } from './Wordmark';

type Props = {
  onStart: () => void;
  reducedMotion: boolean;
};

export function Hero({ onStart, reducedMotion }: Props) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    if (reducedMotion) return;
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;

    import('gsap').then(({ gsap }) => {
      if (cancelled || !root.current) return;
      ctx = gsap.context(() => {
        gsap.set('.reveal', { opacity: 0, y: 14 });
        gsap.to('.reveal', {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.07,
          delay: 0.05,
        });
      }, root);
    });

    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, [reducedMotion]);

  return (
    <section ref={root} className="screen flex flex-col">
      <header className="shell flex items-center justify-between pt-6 md:pt-8">
        <Wordmark className="reveal" />
        <span className="reveal text-[0.8rem] uppercase tracking-[0.16em] text-ink-faint">
          Разработка сайтов
        </span>
      </header>

      <div className="shell flex flex-1 flex-col justify-center py-10 md:py-16">
        <div className="max-w-[46rem]">
          <p className="reveal mb-6 flex items-center gap-3 text-[0.8rem] uppercase tracking-[0.16em] text-ink-faint">
            <span aria-hidden className="inline-block h-px w-8 bg-line" />
            Семь вопросов
          </p>

          <h1 className="reveal text-[2rem] font-medium leading-[1.08] tracking-[-0.02em] xs:text-[2.35rem] sm:text-[3.1rem] md:text-[4rem]">
            Стоимость сайта под вашу задачу — за минуту
          </h1>

          <p className="reveal mt-6 max-w-column text-[1.05rem] leading-[1.55] text-ink-soft md:mt-8 md:text-[1.2rem]">
            Ответьте на семь коротких вопросов. Вилка цены появится сразу на этом
            экране — без звонков и ожидания.
          </p>

          <div className="reveal mt-9 md:mt-12">
            <button
              type="button"
              onClick={onStart}
              className="group inline-flex w-full items-center justify-center gap-3 rounded-full bg-ink px-8 py-[1.15rem] text-[1.05rem] font-medium text-on-ink transition-transform duration-300 ease-aurea will-change-transform hover:-translate-y-0.5 active:translate-y-0 sm:w-auto sm:px-11 sm:py-[1.25rem] sm:text-[1.1rem]"
            >
              Рассчитать стоимость
              <span
                aria-hidden
                className="transition-transform duration-300 ease-aurea group-hover:translate-x-1"
              >
                →
              </span>
            </button>

            <p className="mt-4 text-[0.9rem] text-ink-faint">
              Около минуты. Цену покажу до того, как спрошу контакты.
            </p>
          </div>
        </div>
      </div>

      <div className="shell pb-8">
        <span className="text-[0.8rem] text-ink-faint" aria-hidden>
          ↓ Как это устроено
        </span>
      </div>
    </section>
  );
}
