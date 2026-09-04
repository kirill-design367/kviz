'use client';

import { useCallback, useEffect, useState } from 'react';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { SiteFooter } from './SiteFooter';
import { Quiz, type QuizView } from './Quiz';
import { usePrefersReducedMotion, useSmoothScroll } from '@/lib/motion';
import { GOALS, initMetrika, reachGoal } from '@/lib/metrika';
import { captureSource, loadState, type SavedState } from '@/lib/storage';
import { isComplete } from '@/lib/quiz';

export function Landing() {
  const reducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedState | null>(null);

  useSmoothScroll(!open);

  useEffect(() => {
    document.documentElement.classList.add('js-ready');
    initMetrika();
    captureSource();

    // Ответы переживают обновление страницы: возвращаем человека туда, где он был.
    const state = loadState();
    setSaved(state);
    const started = Object.keys(state.answers).length > 0;
    if (started) setOpen(true);
  }, []);

  const start = useCallback(() => {
    reachGoal(GOALS.quizStart);
    setSaved(loadState());
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const initialView: QuizView =
    saved && saved.finished && isComplete(saved.answers) ? 'result' : 'questions';

  return (
    <>
      <Hero onStart={start} reducedMotion={reducedMotion} />
      <HowItWorks />
      <SiteFooter />

      {open ? (
        <Quiz
          initialStep={saved?.step ?? 0}
          initialAnswers={saved?.answers ?? {}}
          initialView={initialView}
          reducedMotion={reducedMotion}
          onClose={close}
        />
      ) : null}
    </>
  );
}
