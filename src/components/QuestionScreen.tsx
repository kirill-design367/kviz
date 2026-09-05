'use client';

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuizQuestion, Answers } from '@/lib/quiz';
import { usePointerTilt } from '@/lib/tilt';

type Props = {
  /** Все вопросы анкеты — по ним считается постоянная высота карточки. */
  questions: QuizQuestion[];
  /** Тот, который сейчас на экране. */
  current: QuizQuestion;
  answers: Answers;
  onSelect: (optionId: string) => void;
  disabled: boolean;
  reducedMotion: boolean;
  /** Идёт переход между вопросами — наклон на это время не нужен. */
  busy: boolean;
};

/**
 * Один вопрос — один экран, но экран объёмный.
 *
 * Карточка стоит в перспективе и наклоняется за указателем, содержимое
 * разложено по слоям вглубь, варианты приподнимаются навстречу руке.
 * Всё движение — transform и opacity, ничего пересчитывающего раскладку.
 *
 * Ради прохождения объём нигде не мешает: варианты остаются обычными
 * кнопками с ролью radio, тапаемая зона не меньше 44 px, наклон отключён
 * на сенсорных экранах и при prefers-reduced-motion.
 *
 * ВЫСОТА КАРТОЧКИ ПОСТОЯННА — её держит распорка.
 *
 * Высота вопроса зависит от числа вариантов и от того, переносится ли
 * заголовок: разброс 54 px на телефоне и 67 на десктопе. Карточка
 * отцентрована, поэтому половина разницы уезжала вверх, половина вниз —
 * и при каждом ответе дёргалась вся страница.
 *
 * Распорка — невидимая копия вопроса. Она стоит в потоке и задаёт высоту
 * сцены, а живая карточка лежит поверх неё абсолютом во всю её высоту.
 * Копия и карточка раскладываются в одном проходе и на одной ширине,
 * поэтому высота совпадает точно. Замер «один раз и снести распорку»
 * этой точности не даёт: одиночный замер попадает в переходную раскладку
 * и ошибается на пять пикселей — ровно настолько, что самый высокий
 * вопрос перестаёт влезать.
 *
 * В распорке лежит РОВНО ОДИН вопрос — самый высокий. Какой именно,
 * выясняется первым проходом: тогда в ней ненадолго оказываются все семь,
 * их высоты сравниваются, и дальше остаётся только победитель. Держать
 * в документе все семь постоянно нельзя: браузер тащит их через каждый
 * переход, и доля длинных кадров на десктопе растёт с 3–4 % до 4–9 %.
 * Пересчёт — по смене ширины карточки: от неё зависит вся раскладка.
 */
export const QuestionScreen = forwardRef<HTMLDivElement, Props>(function QuestionScreen(
  { questions, current, answers, onSelect, disabled, reducedMotion, busy },
  ref,
) {
  const card = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLDivElement>(null);
  const [tallest, setTallest] = useState<string | null>(null);

  usePointerTilt(card, { max: 5, enabled: !reducedMotion && !busy });

  useLayoutEffect(() => {
    if (tallest) return;
    const node = sizer.current;
    if (!node) return;
    let best = questions[0]?.id ?? null;
    let bestHeight = -1;
    Array.from(node.children).forEach((child, index) => {
      const height = child.getBoundingClientRect().height;
      if (height > bestHeight) {
        bestHeight = height;
        best = questions[index]?.id ?? best;
      }
    });
    setTallest(best);
  }, [tallest, questions]);

  const repick = useCallback(() => setTallest(null), []);

  useEffect(() => {
    const node = card.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', repick);
      document.fonts?.ready.then(repick).catch(() => {});
      return () => window.removeEventListener('resize', repick);
    }
    // Следим за ШИРИНОЙ: от неё зависят переносы, а значит и высота.
    // На смену высоты не реагируем — распорка сама её и задаёт.
    let last = 0;
    const observer = new ResizeObserver(() => {
      const width = node.getBoundingClientRect().width;
      if (Math.abs(width - last) < 0.5) return;
      last = width;
      repick();
    });
    observer.observe(node);
    // Подменный шрифт и настоящий дают разную высоту строки.
    document.fonts?.ready.then(repick).catch(() => {});
    return () => observer.disconnect();
  }, [repick]);

  const inSizer = tallest ? questions.filter((q) => q.id === tallest) : questions;

  return (
    // Сцена задаёт перспективу и стоит на месте. Внутри неё «depth» — то, что
    // уезжает в глубину при смене вопроса, и «card3d» — то, что наклоняется
    // за указателем. Разделены, чтобы два движения не переписывали
    // один и тот же transform друг у друга.
    <div className="stage relative">
      {/* Живая карточка идёт в разметке первой: тогда `h2` и радиогруппа
          в документе — всегда те, что человек видит, а не из распорки. */}
      <div ref={ref} className="depth absolute inset-0">
        <div ref={card} className="card3d mx-auto h-full w-full max-w-[38rem]">
          <span aria-hidden className="card3d__plate card3d__plate--far" />
          <span aria-hidden className="card3d__plate" />
          <span aria-hidden className="card3d__shadow" />

          <div className="relative">
            <QuestionBody
              question={current}
              selected={answers[current.id]}
              onSelect={onSelect}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <div ref={sizer} aria-hidden className="card3d-sizer mx-auto grid w-full max-w-[38rem]">
        {inSizer.map((question) => (
          <div key={question.id} className="col-start-1 row-start-1 self-start">
            <QuestionBody question={question} />
          </div>
        ))}
      </div>
    </div>
  );
});

type BodyProps = {
  question: QuizQuestion;
  selected?: string;
  /** Есть — вопрос живой; нет — это распорка. */
  onSelect?: (optionId: string) => void;
  disabled?: boolean;
};

// Стрелки внутри группы — то, что скринридер и клавиатурный пользователь
// ожидают от списка вариантов. Выбор при этом не происходит: человек
// переходит фокусом и подтверждает Enter или пробелом.
function onArrows(event: React.KeyboardEvent<HTMLUListElement>) {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
  );
  if (buttons.length === 0) return;
  const index = buttons.findIndex((b) => b === document.activeElement);
  const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
  const next = (index + step + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
}

/**
 * Содержимое вопроса. Один и тот же код рисует и живой вопрос, и распорку —
 * теми же элементами и с теми же классами. Иначе высоты разъезжаются:
 * `div` вместо `button` при прочих равных давал на пиксель другую строку,
 * а на пяти вариантах это уже пять пикселей.
 */
function QuestionBody({ question, selected, onSelect, disabled }: BodyProps) {
  const live = Boolean(onSelect);

  return (
    <>
      <p className="figure layer-back mb-2.5 text-[0.9rem] text-ink-faint md:mb-4 md:text-[0.95rem]">
        {String(question.order).padStart(2, '0')}
      </p>

      <h2
        id={live ? `${question.id}-title` : undefined}
        className="layer-front max-w-[22ch] text-[1.45rem] font-medium leading-[1.12] tracking-[-0.015em] xs:text-[1.65rem] sm:text-[2.1rem] md:text-[2.7rem]"
      >
        {question.title}
      </h2>

      {question.caption ? (
        <p className="layer-mid mt-2 max-w-column text-[0.88rem] leading-snug text-ink-faint md:mt-3 md:text-[0.95rem]">
          {question.caption}
        </p>
      ) : null}

      <ul
        role={live ? 'radiogroup' : undefined}
        aria-labelledby={live ? `${question.id}-title` : undefined}
        onKeyDown={live ? onArrows : undefined}
        className="layer-mid mt-4 space-y-1.5 md:mt-7 md:space-y-2"
      >
        {question.options.map((option, index) => {
          const chosen = selected === option.id;
          return (
            <li key={option.id}>
              <button
                type="button"
                role={live ? 'radio' : undefined}
                // В распорке кнопка выключена: внутри aria-hidden не должно
                // быть ничего, куда может попасть фокус.
                disabled={live ? disabled : true}
                aria-checked={live ? chosen : undefined}
                data-selected={chosen ? '1' : '0'}
                tabIndex={live && (chosen || (!selected && index === 0)) ? 0 : -1}
                onClick={live ? () => onSelect?.(option.id) : undefined}
                className={`option3d group relative flex w-full items-center gap-3 px-3.5 py-[0.8rem] text-left md:gap-4 md:px-4 md:py-[1.05rem] ${
                  chosen ? 'text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <span aria-hidden className="option3d__fill" />

                <span
                  aria-hidden
                  className={`figure relative w-4 shrink-0 text-[0.85rem] tabular-nums md:w-5 ${
                    chosen ? 'text-ink' : 'text-ink-faint'
                  }`}
                >
                  {index + 1}
                </span>

                <span className="relative flex-1 text-[0.98rem] leading-[1.28] xs:text-[1.03rem] md:text-[1.15rem]">
                  {option.label}
                </span>

                {/* Отметка выбранного: обводка контуром чернил,
                    заполняется целиком, когда вариант выбран. */}
                <span
                  aria-hidden
                  className={`relative grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150 ${
                    chosen ? 'border-ink' : 'border-line'
                  }`}
                >
                  <span
                    className={`h-[8px] w-[8px] rounded-full bg-ink transition-transform duration-200 ease-aurea ${
                      chosen ? 'scale-100' : 'scale-0'
                    }`}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
