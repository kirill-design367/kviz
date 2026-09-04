'use client';

import { forwardRef, useRef } from 'react';
import type { QuizQuestion } from '@/lib/quiz';

type Props = {
  question: QuizQuestion;
  selected?: string;
  onSelect: (optionId: string) => void;
  disabled: boolean;
};

/**
 * Один вопрос — один экран. Ничего, кроме номера, вопроса и вариантов.
 * Варианты — обычные кнопки: работают с клавиатуры и со скринридером,
 * тапаемая зона не меньше 56 px по высоте.
 */
export const QuestionScreen = forwardRef<HTMLDivElement, Props>(function QuestionScreen(
  { question, selected, onSelect, disabled },
  ref,
) {
  const list = useRef<HTMLUListElement>(null);

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
    <div ref={ref} className="will-change-transform">
      <p className="figure mb-5 text-[0.95rem] text-ink-faint md:mb-7">
        {String(question.order).padStart(2, '0')}
      </p>

      <h2 id={`${question.id}-title`} className="max-w-[22ch] text-[1.65rem] font-medium leading-[1.14] tracking-[-0.015em] xs:text-[1.9rem] sm:text-[2.3rem] md:text-[2.9rem]">
        {question.title}
      </h2>

      {question.caption ? (
        <p className="mt-3 max-w-column text-[0.9rem] leading-relaxed text-ink-faint md:text-[0.95rem]">
          {question.caption}
        </p>
      ) : null}

      <ul
        ref={list}
        role="radiogroup"
        aria-labelledby={`${question.id}-title`}
        onKeyDown={onArrows}
        className="mt-8 max-w-column md:mt-10"
      >
        {question.options.map((option, index) => {
          const active = selected === option.id;
          return (
            <li key={option.id} className="border-t border-line last:border-b">
              <button
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={active}
                tabIndex={active || (!selected && index === 0) ? 0 : -1}
                onClick={() => onSelect(option.id)}
                className={`group flex w-full items-center gap-4 py-[1.05rem] text-left transition-colors duration-200 md:py-[1.15rem] ${
                  active ? 'text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <span
                  aria-hidden
                  className={`figure w-6 shrink-0 text-[0.85rem] tabular-nums ${
                    active ? 'text-gold' : 'text-ink-faint'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="flex-1 text-[1.05rem] leading-[1.35] md:text-[1.15rem]">
                  {option.label}
                </span>
                <span
                  aria-hidden
                  className={`h-[7px] w-[7px] shrink-0 rounded-full transition-transform duration-300 ease-aurea ${
                    active ? 'scale-100 bg-gold' : 'scale-0 bg-line'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
