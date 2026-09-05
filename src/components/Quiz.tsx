'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { visibleQuestions, isComplete, type Answers } from '@/lib/quiz';
import { calculatePrice } from '@/lib/pricing';
import { GOALS, reachGoal } from '@/lib/metrika';
import { Progress } from './Progress';
import { QuestionScreen } from './QuestionScreen';
import { PriceResult } from './PriceResult';
import { LeadForm } from './LeadForm';
import { Success } from './Success';
import { Wordmark } from './Wordmark';

export type QuizView = 'questions' | 'result' | 'success';

type Props = {
  reducedMotion: boolean;
  onClose: () => void;
};

// Вперёд — спокойно, назад — быстрее: исправление своей ошибки не должно
// ощущаться как наказание.
// Суммарно вперёд — 0,6 с. Это потолок: семь вопросов при 0,72 с давали пять
// секунд одних переходов, и быстрый тап попадал в защёлку и терялся.
const OUT_DURATION = 0.22;
const IN_DURATION = 0.38;
const BACK_OUT_DURATION = 0.15;
const BACK_IN_DURATION = 0.27;
/** Сколько держать защёлку, когда анимация выключена: страховка от двойного тапа. */
const TAP_GUARD_MS = 140;

/**
 * Насколько далеко карточка уходит в глубину при смене вопроса.
 * На телефоне ход короче: экран близко к глазам, и сильный пролёт
 * читается как рывок, а не как движение.
 */
function depthTravel() {
  if (typeof window === 'undefined') return { out: 240, in: 300, tilt: 10 };
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  return narrow ? { out: 120, in: 150, tilt: 6 } : { out: 240, in: 300, tilt: 10 };
}

export function Quiz({ reducedMotion, onClose }: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [view, setView] = useState<QuizView>('questions');
  // Способ связи приходит из формы: подтверждение должно говорить то же,
  // что человек выбрал, а не всегда «напишу в Telegram».
  const [channel, setChannel] = useState('call');

  const card = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  /**
   * Идёт ли переход между вопросами. Наклон карточки за указателем на это
   * время выключается: покадровое обновление наклона и движение по Z вместе
   * дают до 15 % длинных кадров на большом экране, а по отдельности — почти
   * ничего. Во время перехода наклон всё равно не нужен.
   */
  const [busy, setBusy] = useState(false);
  const direction = useRef(1);

  // Список пересчитывается по ответам: выбрал магазин в первом вопросе —
  // вопрос про структуру выпадает, и шагов становится шесть.
  const questions = visibleQuestions(answers);
  const total = questions.length;
  const question = questions[Math.min(step, total - 1)];
  const price = calculatePrice(answers);

  // --- цель «показана вилка» -------------------------------------------- //

  useEffect(() => {
    if (view === 'result') reachGoal(GOALS.resultShown);
  }, [view]);

  // --- появление нового вопроса ----------------------------------------- //

  useLayoutEffect(() => {
    if (view !== 'questions') return;
    const node = card.current;
    if (!node) return;

    if (reducedMotion) {
      node.style.opacity = '1';
      node.style.transform = 'none';
      locked.current = false;
      setBusy(false);
      return;
    }

    let cancelled = false;
    node.style.opacity = '0';

    import('gsap').then(({ gsap }) => {
      if (cancelled || !card.current) return;
      const travel = depthTravel();
      const forward = direction.current > 0;
      // Следующий вопрос приходит из глубины навстречу, предыдущий —
      // возвращается спереди. Направление читается телом, а не подписью.
      gsap.fromTo(
        card.current,
        {
          opacity: 0,
          z: forward ? -travel.in : travel.in,
          rotationY: forward ? travel.tilt : -travel.tilt,
          rotationX: forward ? -travel.tilt * 0.35 : travel.tilt * 0.35,
        },
        {
          opacity: 1,
          z: 0,
          rotationY: 0,
          rotationX: 0,
          duration: forward ? IN_DURATION : BACK_IN_DURATION,
          ease: 'power3.out',
          clearProps: 'transform',
          onComplete: () => {
            locked.current = false;
            setBusy(false);
          },
        },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [step, view, reducedMotion]);

  // --- переходы ---------------------------------------------------------- //

  const transition = useCallback(
    (apply: () => void, dir: 1 | -1) => {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      direction.current = dir;

      if (reducedMotion || !card.current) {
        apply();
        // Двойной тап по варианту приходит в одном кадре и без анимации
        // проскочил бы сразу в следующий вопрос.
        window.setTimeout(() => {
          locked.current = false;
          setBusy(false);
        }, TAP_GUARD_MS);
        return;
      }

      import('gsap').then(({ gsap }) => {
        if (!card.current) {
          apply();
          locked.current = false;
          return;
        }
        const travel = depthTravel();
        gsap.to(card.current, {
          opacity: 0,
          z: dir > 0 ? travel.out : -travel.out,
          rotationY: dir > 0 ? -travel.tilt * 0.8 : travel.tilt * 0.8,
          rotationX: dir > 0 ? travel.tilt * 0.3 : -travel.tilt * 0.3,
          duration: dir > 0 ? OUT_DURATION : BACK_OUT_DURATION,
          ease: 'power2.in',
          onComplete: apply,
        });
      });
    },
    [reducedMotion],
  );

  const select = useCallback(
    (optionId: string) => {
      if (locked.current) return;
      const next = { ...answers, [question.id]: optionId };
      setAnswers(next);
      reachGoal(GOALS.quizStep(question.order));

      // Список считаем по НОВЫМ ответам: ответ на первый вопрос может
      // убрать вопрос про структуру, и последним станет шестой шаг.
      const nextTotal = visibleQuestions(next).length;
      const isLast = step >= nextTotal - 1;
      transition(() => {
        if (isLast && isComplete(next)) setView('result');
        else setStep((current) => Math.min(current + 1, nextTotal - 1));
      }, 1);
    },
    [answers, question, step, transition],
  );

  const back = useCallback(() => {
    if (view === 'result') {
      reachGoal(GOALS.quizBack, undefined, false);
      setView('questions');
      setStep(total - 1);
      return;
    }
    if (step === 0) {
      onClose();
      return;
    }
    reachGoal(GOALS.quizBack, undefined, false);
    transition(() => setStep((current) => Math.max(0, current - 1)), -1);
  }, [step, total, view, transition, onClose]);

  // --- клавиатура --------------------------------------------------------- //

  useEffect(() => {
    if (view !== 'questions') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        back();
        return;
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < question.options.length) {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        event.preventDefault();
        select(question.options[index].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, question, select, back]);

  // --- блокировка прокрутки страницы под оверлеем ------------------------- //

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const inverted = view !== 'questions';

  return (
    <div
      className={`overlay-in tone fixed inset-0 z-50 overflow-y-auto bg-paper ${
        inverted ? 'inverted' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Расчёт стоимости сайта"
    >
      {/* Чернильный фон экрана с вилкой проявляется, а не включается щелчком. */}
      <span aria-hidden className="ink-veil" data-on={inverted ? '1' : '0'} />

      <div className="shell relative z-10 flex min-h-full flex-col py-5 md:py-7">
        <header className="flex items-center justify-between">
          <Wordmark className={inverted ? 'text-on-ink' : ''} />
          <button
            type="button"
            onClick={view === 'questions' ? onClose : view === 'success' ? onClose : back}
            className={`-mr-2 rounded-full px-3 py-2 text-[0.9rem] transition-opacity duration-200 hover:opacity-70 ${
              inverted ? 'text-on-ink-soft' : 'text-ink-faint'
            }`}
          >
            {view === 'result' ? 'Назад' : view === 'success' ? 'Закрыть' : 'Выйти'}
          </button>
        </header>

        {view === 'questions' ? (
          <div className="mt-7 md:mt-10">
            <Progress current={step} total={total} reducedMotion={reducedMotion} />
          </div>
        ) : null}

        <main
          className={`flex flex-1 flex-col justify-center ${
            view === 'result' ? 'py-3 md:py-8' : 'py-9 md:py-12'
          }`}
        >
          {/* Возврат стоит НАД карточкой и слева: подпись сверху, стрелка под ней. */}
          {view === 'questions' ? (
            <div className="mb-6 flex flex-col items-start gap-2 md:mb-8">
              <span id="back-hint" className="text-[0.8rem] text-ink-faint">
                Можно вернуться и поменять ответ
              </span>
              <button
                type="button"
                onClick={back}
                aria-describedby="back-hint"
                aria-label={
                  step === 0 ? 'Вернуться на первый экран' : 'Вернуться к предыдущему вопросу'
                }
                className="back-arrow grid h-11 w-11 place-items-center rounded-full border border-line text-ink-soft"
              >
                <span aria-hidden className="text-[1.1rem] leading-none">
                  ←
                </span>
              </button>
            </div>
          ) : null}

          {view === 'questions' ? (
            <QuestionScreen
              ref={card}
              question={question}
              selected={answers[question.id]}
              onSelect={select}
              disabled={false}
              reducedMotion={reducedMotion}
              busy={busy}
            />
          ) : null}

          {/* Вилка и форма в одном кадре: человек видит цифру и тут же поля,
              листать за формой не нужно. На широком экране — две колонки,
              на телефоне — плотная колонка, которая помещается в экран. */}
          {view === 'result' ? (
            <div className="mx-auto grid w-full max-w-[62rem] items-center gap-6 lg:grid-cols-2 lg:gap-16">
              <div>
                <PriceResult price={price} reducedMotion={reducedMotion} />
              </div>
              <div>
                <LeadForm
                  answers={answers}
                  price={price}
                  onSent={(chosen) => {
                    setChannel(chosen);
                    setView('success');
                  }}
                />
              </div>
            </div>
          ) : null}

          {view === 'success' ? <Success channel={channel} reducedMotion={reducedMotion} /> : null}
        </main>

        <footer className="pb-2" />
      </div>
    </div>
  );
}

