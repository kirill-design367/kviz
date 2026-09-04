import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

export default function NotFound() {
  return (
    <main className="screen flex flex-col">
      <header className="shell pt-6 md:pt-8">
        <Wordmark />
      </header>

      <div className="shell flex flex-1 flex-col justify-center py-16">
        <p className="figure text-[0.95rem] text-gold">404</p>
        <h1 className="mt-4 max-w-[16ch] text-[2rem] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[2.8rem]">
          Такой страницы нет
        </h1>
        <p className="mt-5 max-w-column text-[1.05rem] leading-relaxed text-ink-soft">
          Возможно, ссылка устарела или в ней опечатка. Расчёт стоимости
          на месте — он на первом экране.
        </p>
        <div className="mt-9">
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-full bg-ink px-8 py-[1.05rem] text-[1rem] font-medium text-on-ink transition-transform duration-300 ease-aurea hover:-translate-y-0.5"
          >
            На первый экран
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
