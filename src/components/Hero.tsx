'use client';

import { Wordmark } from './Wordmark';
import { STEPS } from './steps';

type Props = {
  onStart: () => void;
};

/** Задержка появления, шаг за шагом. Выключается через prefers-reduced-motion. */
const delay = (step: number) => ({ '--d': `${0.05 + step * 0.06}s` }) as React.CSSProperties;

export function Hero({ onStart }: Props) {
  return (
    <section className="screen flex flex-col">
      <header className="shell flex items-center justify-between pt-6 md:pt-8">
        <Wordmark className="reveal" style={delay(0)} />
        <span style={delay(1)} className="reveal text-[0.68rem] uppercase tracking-[0.14em] text-ink-faint sm:text-[0.78rem] sm:tracking-[0.16em]">
          Разработка сайтов
        </span>
      </header>

      <div className="shell flex flex-1 items-center py-10 md:py-14">
        <div className="grid w-full gap-14 lg:grid-cols-12 lg:items-end lg:gap-10">
          {/* Левая колонка: оффер и единственное действие на экране */}
          <div className="lg:col-span-7 xl:col-span-7">
            <p style={delay(2)} className="reveal mb-6 flex items-center gap-3 text-[0.8rem] uppercase tracking-[0.16em] text-ink-faint">
              <span aria-hidden className="inline-block h-px w-8 bg-line" />
              Семь вопросов
            </p>

            <h1 style={delay(3)} className="reveal text-[2rem] font-medium leading-[1.06] tracking-[-0.02em] xs:text-[2.35rem] sm:text-[3.1rem] lg:text-[3.6rem] xl:text-[4.25rem]">
              Стоимость сайта под вашу задачу — за минуту
            </h1>

            <p style={delay(4)} className="reveal mt-6 max-w-column text-[1.05rem] leading-[1.55] text-ink-soft md:mt-8 md:text-[1.2rem]">
              Ответьте на семь коротких вопросов. Вилка цены появится сразу
              на этом экране — без звонков и ожидания.
            </p>

            <div style={delay(5)} className="reveal mt-9 md:mt-11">
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

          {/* Правая колонка: те же три шага, что ниже на узких экранах.
              На широком экране им место здесь — иначе половина полосы пустует,
              а человеку приходится скроллить за объяснением. */}
          <ol style={delay(6)} className="reveal hidden lg:col-span-4 lg:col-start-9 lg:block">
            {STEPS.map((step) => (
              <li key={step.n} className="border-t border-line-soft py-5 last:border-b">
                <div className="flex gap-4">
                  <span className="figure mt-0.5 shrink-0 text-[0.9rem] text-gold">{step.n}</span>
                  <div>
                    <h2 className="text-[1.02rem] font-medium leading-snug">{step.title}</h2>
                    <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-soft">
                      {step.body}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="shell pb-8 lg:hidden">
        <span className="text-[0.8rem] text-ink-faint" aria-hidden>
          ↓ Как это устроено
        </span>
      </div>
    </section>
  );
}
