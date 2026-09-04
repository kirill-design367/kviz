import Link from 'next/link';
import type { Metadata } from 'next';
import { Wordmark } from '@/components/Wordmark';
import { LEGAL, LEGAL_FILLED } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Политика обработки персональных данных — AUREA',
  description: 'Какие данные собирает форма расчёта стоимости, зачем и как долго они хранятся.',
  robots: { index: false, follow: true },
};

const SECTIONS = [
  {
    title: 'Какие данные собираются',
    body: 'Имя и номер телефона, которые вы вводите в форму. Выбранный способ связи. Ответы на семь вопросов квиза и посчитанная по ним вилка стоимости. Метки рекламной кампании из адреса страницы и адрес страницы, с которой вы пришли.',
  },
  {
    title: 'Зачем',
    body: 'Чтобы связаться с вами по вашей заявке, подготовить расчёт по вашей задаче и понять, из какой рекламной кампании пришло обращение. Ни для чего другого данные не используются.',
  },
  {
    title: 'Кому передаются',
    body: 'Заявка приходит в Telegram владельцу сайта. Третьим лицам данные не передаются и не продаются. Рассылок нет.',
  },
  {
    title: 'Сколько хранятся',
    body: 'До завершения работы по обращению или до вашего отзыва согласия — смотря что наступит раньше.',
  },
  {
    title: 'Ваши права',
    body: 'Вы можете запросить, какие ваши данные хранятся, потребовать их исправить или удалить, а также отозвать согласие. Для этого напишите на адрес, указанный ниже.',
  },
  {
    title: 'Что считается согласием',
    body: 'Отправляя форму, вы подтверждаете согласие на обработку перечисленных данных на условиях этой страницы.',
  },
  {
    title: 'Аналитика',
    body: 'На сайте работает Яндекс Метрика. Она собирает обезличенные данные о посещении: устройство, источник перехода, действия на странице. Отказаться можно, отключив cookie в браузере.',
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-svh">
      <header className="shell flex items-center justify-between pt-6 md:pt-8">
        <Link href="/" className="transition-opacity hover:opacity-70">
          <Wordmark />
        </Link>
        <Link href="/" className="text-[0.9rem] text-ink-faint transition-opacity hover:opacity-70">
          На первый экран
        </Link>
      </header>

      <div className="shell max-w-[46rem] py-14 md:py-20">
        <h1 className="text-[1.9rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.5rem]">
          Политика обработки персональных данных
        </h1>

        <p className="mt-5 text-[1.02rem] leading-relaxed text-ink-soft">
          Короткая и по делу: что именно собирает форма расчёта стоимости, зачем
          и что с этим можно сделать.
        </p>

        <ol className="mt-12 space-y-9">
          {SECTIONS.map((section, index) => (
            <li key={section.title} className="border-t border-line-soft pt-6">
              <span className="figure text-[0.9rem] text-gold">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className="mt-2 text-[1.15rem] font-medium leading-snug">{section.title}</h2>
              <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-soft">{section.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 border-t border-line pt-6">
          <h2 className="text-[1.15rem] font-medium">Оператор</h2>
          {LEGAL_FILLED ? (
            <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-soft">
              {LEGAL.operator}
              {LEGAL.registry ? `, ${LEGAL.registry}` : ''}. Обращения по персональным
              данным: {LEGAL.email}
            </p>
          ) : (
            <p className="mt-2 text-[0.98rem] leading-relaxed text-error">
              Реквизиты оператора не заполнены. Их нужно указать в файле
              <code className="mx-1 rounded bg-gold-soft px-1.5 py-0.5 text-[0.9em]">
                src/lib/legal.ts
              </code>
              до запуска рекламы: модерация Яндекс Директа проверяет наличие политики
              и данных оператора.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
