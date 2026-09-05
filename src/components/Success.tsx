'use client';

import { useEffect, useRef } from 'react';

export function Success({ channel, reducedMotion }: { channel: string; reducedMotion: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion || !root.current) return;
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;
    import('gsap').then(({ gsap }) => {
      if (cancelled || !root.current) return;
      ctx = gsap.context(() => {
        gsap.from('[data-appear]', {
          opacity: 0,
          y: 14,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.1,
        });
      }, root);
    });
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, [reducedMotion]);

  return (
    <div ref={root} className="max-w-column" role="status">
      <p
        data-appear
        className="mb-6 text-[0.8rem] uppercase tracking-[0.16em] text-ink-soft"
      >
        Заявка принята
      </p>

      <h2
        data-appear
        className="text-[2rem] font-medium leading-[1.1] tracking-[-0.015em] sm:text-[2.6rem]"
      >
        Спасибо, записал
      </h2>

      <p data-appear className="mt-5 text-[1.05rem] leading-relaxed text-ink-soft">
        Перезвоню в течение семи минут в рабочее время. Если сейчас ночь — утром,
        первым делом. {channel === 'telegram' ? 'Напишу в Telegram.' : 'Наберу по телефону.'}
      </p>

      <p data-appear className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
        К разговору подготовлю точный расчёт по вашим ответам и несколько работ,
        близких к вашей задаче.
      </p>
    </div>
  );
}
