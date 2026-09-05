'use client';

import { useCallback, useEffect, useState } from 'react';
import { Hero } from './Hero';
import { SiteFooter } from './SiteFooter';
import { Quiz } from './Quiz';
import { usePrefersReducedMotion, useSmoothScroll } from '@/lib/motion';
import { GOALS, initMetrika, reachGoal } from '@/lib/metrika';
import { captureSource, clearLegacyState } from '@/lib/storage';

export function Landing() {
  const reducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);

  useSmoothScroll(!open);

  useEffect(() => {
    initMetrika();
    captureSource();
    // Прохождение больше не восстанавливается: любая загрузка начинается
    // с первого экрана. Старый ключ подчищаем, чтобы не оставался мусор.
    clearLegacyState();
  }, []);

  const start = useCallback(() => {
    reachGoal(GOALS.quizStart);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <main>
        <Hero onStart={start} />
      </main>
      <SiteFooter />

      {open ? <Quiz reducedMotion={reducedMotion} onClose={close} /> : null}
    </>
  );
}
