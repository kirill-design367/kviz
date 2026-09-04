import { Wordmark } from './Wordmark';

export function SiteFooter() {
  return (
    <footer className="shell flex flex-col gap-4 border-t border-line-soft py-10 text-[0.85rem] text-ink-faint md:flex-row md:items-center md:justify-between">
      <Wordmark className="text-ink" />
      <p className="max-w-[34rem] leading-relaxed">
        Разработка сайтов. Телефон, который вы оставите, нужен только для ответа
        по заявке.
      </p>
    </footer>
  );
}
