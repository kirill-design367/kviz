import { STEPS } from './steps';

/** Ниже первого экрана — только для узких экранов: на широких эти же три шага
    стоят в правой колонке первого экрана, и повторять их незачем. */
export function HowItWorks() {
  return (
    <section className="shell border-t border-line-soft py-16 md:py-20 lg:hidden">
      <h2 className="text-[0.8rem] uppercase tracking-[0.16em] text-ink-faint">Как это устроено</h2>

      <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-12">
        {STEPS.map((step) => (
          <li key={step.n}>
            <span className="figure text-[0.95rem] text-gold">{step.n}</span>
            <h3 className="mt-3 text-[1.25rem] font-medium leading-snug tracking-[-0.01em] md:text-[1.35rem]">
              {step.title}
            </h3>
            <p className="mt-2.5 text-[0.98rem] leading-relaxed text-ink-soft">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
