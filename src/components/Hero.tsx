'use client';

import { Wordmark } from './Wordmark';

type Props = {
  onStart: () => void;
};

/** Задержка появления, шаг за шагом. Выключается через prefers-reduced-motion. */
const delay = (step: number) => ({ '--d': `${0.05 + step * 0.06}s` }) as React.CSSProperties;

/**
 * Первый экран: логотип, заголовок по центру и одна кнопка.
 * Больше на экране нет ничего — всё, что не ведёт к нажатию, убрано.
 */
export function Hero({ onStart }: Props) {
  return (
    <section className="screen flex flex-col">
      <header className="shell pt-6 md:pt-8">
        <Wordmark className="reveal" style={delay(0)} />
      </header>

      <div className="shell flex flex-1 items-center justify-center py-10 text-center md:py-14">
        <div className="w-full max-w-[52rem]">
          {/* Три строки, и ровно эти три: разбивка не отдана на откуп
              браузеру, поэтому она одинакова на любом экране. Каждая
              строка неразрывна, а размер шрифта считается от ширины
              колонки — так самая длинная строка всегда помещается
              целиком и ни одно слово не переносится. */}
          <h1 style={delay(1)} className="heading-anticva heading-lines reveal">
            <span className="block">Узнайте стоимость</span>
            <span className="block">вашего сайта</span>
            <span className="block">за минуту</span>
          </h1>

          <p
            style={delay(2)}
            className="reveal mx-auto mt-6 max-w-[34rem] text-[1.05rem] leading-[1.55] text-ink-soft md:mt-8 md:text-[1.15rem]"
          >
            Ответьте на семь коротких вопросов. Вилка цены появится сразу
            на этом экране — без звонков и ожидания.
          </p>

          <div style={delay(3)} className="reveal mt-9 md:mt-11">
            <button
              type="button"
              onClick={onStart}
              className="btn-invert w-full px-8 py-[1.15rem] text-[1.05rem] font-medium sm:w-auto sm:px-12 sm:py-[1.3rem] sm:text-[1.12rem]"
            >
              {/* Светлый слой — это и есть инверсия: он проявляется поверх
                  чернильной панели, а цвет текста идёт ему навстречу. */}
              <span aria-hidden className="btn-invert__fill" />
              Рассчитать стоимость
              <span aria-hidden className="btn-invert__arrow">
                →
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
