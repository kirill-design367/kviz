'use client';

import { forwardRef, useRef } from 'react';
import type { QuizQuestion } from '@/lib/quiz';
import { usePointerTilt } from '@/lib/tilt';

type Props = {
  question: QuizQuestion;
  selected?: string;
  onSelect: (optionId: string) => void;
  disabled: boolean;
  reducedMotion: boolean;
};

/**
 * Один вопрос — один экран, но экран объёмный.
 *
 * Карточка стоит в перспективе и наклоняется за указателем, содержимое
 * разложено по слоям вглубь, варианты приподнимаются навстречу руке.
 * Всё движение — transform и opacity, ничего пересчитывающего раскладку.
 *
 * Ради прохождения объём нигде не мешает: варианты остаются обычными
 * кнопками с ролью radio, тапаемая зона не меньше 56 px, наклон отключён
 * на сенсорных экранах и при prefers-reduced-motion.
 */
export const QuestionScreen = forwardRef<HTMLDivElement, Props>(function QuestionScreen(
  { question, selected, onSelect, disabled, reducedMotion },
  ref,
) {
  const list = useRef<HTMLUListElement>(null);
  const card = useRef<HTMLDivElement>(null);

  usePointerTilt(card, { max: 5, enabled: !reducedMotion });

  // Стрелки внутри группы — то, что скринридер и клавиатурный пользователь
  // ожидают от списка вариантов. Выбор при этом не происходит: человек
  // переходит фокусом и подтверждает Enter или пробелом.
  const onArrows = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [],
    );
    if (buttons.length === 0) return;
    const current = buttons.findIndex((b) => b === document.activeElement);
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const next = (current + step + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  };

  return (
    // Сцена задаёт перспективу и стоит на месте. Внутри неё «depth» — то, что
    // уезжает в глубину при смене вопроса, и «card3d» — то, что наклоняется
    // за указателем. Разделены, чтобы два движения не переписывали
    // один и тот же transform друг у друга.
    <div className="stage">
      <div ref={ref} className="depth">
        <div ref={card} className="card3d mx-auto w-full max-w-[38rem]">
          <span aria-hidden className="card3d__plate card3d__plate--far" />
          <span aria-hidden className="card3d__plate" />
          <span aria-hidden className="card3d__shadow" />

          <div className="relative">
            <p className="figure layer-back mb-4 text-[0.95rem] text-ink-faint md:mb-5">
              {String(question.order).padStart(2, '0')}
            </p>

            <h2
              id={`${question.id}-title`}
              className="layer-front max-w-[22ch] text-[1.65rem] font-medium leading-[1.14] tracking-[-0.015em] xs:text-[1.9rem] sm:text-[2.3rem] md:text-[2.9rem]"
            >
              {question.title}
            </h2>

            {question.caption ? (
              <p className="layer-mid mt-3 max-w-column text-[0.9rem] leading-relaxed text-ink-faint md:text-[0.95rem]">
                {question.caption}
              </p>
            ) : null}

            <ul
              ref={list}
              role="radiogroup"
              aria-labelledby={`${question.id}-title`}
              onKeyDown={onArrows}
              className="layer-mid mt-6 space-y-1.5 md:mt-8 md:space-y-2"
            >
              {question.options.map((option, index) => {
                const active = selected === option.id;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="radio"
                      disabled={disabled}
                      aria-checked={active}
                      data-selected={active ? '1' : '0'}
                      tabIndex={active || (!selected && index === 0) ? 0 : -1}
                      onClick={() => onSelect(option.id)}
                      className={`option3d group relative flex w-full items-center gap-3 px-3.5 py-[0.95rem] text-left md:gap-4 md:px-4 md:py-[1.05rem] ${
                        active ? 'text-ink' : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <span aria-hidden className="option3d__fill" />

                      <span
                        aria-hidden
                        className={`figure relative w-4 shrink-0 text-[0.85rem] tabular-nums md:w-5 ${
                          active ? 'text-ink' : 'text-ink-faint'
                        }`}
                      >
                        {index + 1}
                      </span>

                      <span className="relative flex-1 text-[1rem] leading-[1.3] xs:text-[1.05rem] md:text-[1.15rem]">
                        {option.label}
                      </span>

                      {/* Отметка выбранного: обводка контуром чернил,
                          заполняется целиком, когда вариант выбран. */}
                      <span
                        aria-hidden
                        className={`relative grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150 ${
                          active ? 'border-ink' : 'border-line'
                        }`}
                      >
                        <span
                          className={`h-[8px] w-[8px] rounded-full bg-ink transition-transform duration-200 ease-aurea ${
                            active ? 'scale-100' : 'scale-0'
                          }`}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
              </ul>
          </div>
        </div>
      </div>
    </div>
  );
});
