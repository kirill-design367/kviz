'use client';

import { useEffect, useState } from 'react';

/** Настройка «меньше движения» из системы. Меняется без перезагрузки страницы. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

/**
 * Плавный скролл страницы. Библиотека грузится динамически и только когда
 * движение разрешено: на мобильном при «меньше движения» лишние 3 КБ не нужны.
 */
export function useSmoothScroll(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Тонкие экраны и без того скроллятся нативно приятно, а Lenis
    // на слабом Android отъедает кадры. Включаем только с указателем мыши.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let stopped = false;
    let raf = 0;
    let instance: { raf: (t: number) => void; destroy: () => void } | null = null;

    import('lenis').then(({ default: Lenis }) => {
      if (stopped) return;
      instance = new Lenis({ duration: 0.9, smoothWheel: true, autoRaf: false });
      const tick = (time: number) => {
        instance?.raf(time);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      instance?.destroy();
    };
  }, [enabled]);
}
