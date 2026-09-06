import Link from 'next/link';
import type { Metadata } from 'next';
import { Wordmark } from '@/components/Wordmark';
import { LEGAL } from '@/lib/legal';
import { YM_ID } from '@/lib/metrika';

export const metadata: Metadata = {
  title: 'Политика обработки персональных данных — AUREA',
  description:
    'Кто собирает данные с этой страницы, какие именно, зачем, сколько они хранятся и как их удалить.',
  robots: { index: false, follow: true },
};

/* Номер счётчика на странице и номер в коде обязаны совпадать: расхождение
   означало бы, что человеку названо не то, что на самом деле собирает данные.
   Поэтому берём из той же переменной сборки, а запасной вариант — из legal.ts,
   чтобы страница не пустела при локальной сборке без счётчика. */
const COUNTER = YM_ID || LEGAL.metrika;

type Item = { label: string; text: string };
type Section = { title: string; body?: string; items?: Item[]; after?: string };

const SECTIONS: Section[] = [
  {
    title: 'Какие данные собираются',
    body: 'Всё, что уходит из формы, вы вводите сами и видите на экране. Список полный:',
    items: [
      { label: 'Имя', text: 'то, которое вы напечатали в поле.' },
      {
        label: 'Телефон или ник в Telegram',
        text:
          'одно из двух — смотря какой способ связи вы выбрали. Если вы попросили написать в Telegram, номер телефона не спрашивается вовсе.',
      },
      {
        label: 'Ответы на вопросы квиза и посчитанная по ним стоимость',
        text: 'чтобы разговор начинался не с нуля, а с вашей задачи.',
      },
      {
        label: 'Адрес страницы, с которой вы пришли, и метки рекламной кампании из ссылки',
        text: 'чтобы понимать, какая реклама приводит людей.',
      },
      {
        label: 'IP-адрес и строка браузера в момент отправки',
        text:
          'сохраняются вместе с заявкой. Нужны, чтобы отсеивать автоматические отправки и ограничивать число заявок с одного адреса.',
      },
      {
        label: 'Данные Яндекс Метрики',
        text: 'о них отдельно, в пункте 04 — там же про Вебвизор.',
      },
    ],
    after:
      'Ничего сверх этого не спрашивается: ни возраста, ни адреса, ни документов, ни данных карты.',
  },
  {
    title: 'Зачем',
    body:
      'Чтобы связаться с вами по вашей заявке и посчитать стоимость работ. Метки рекламы — чтобы видеть, из какой кампании пришло обращение. Ни для чего другого данные не используются: рассылок нет, в чужие базы они не попадают, реклама по ним не настраивается.',
  },
  {
    title: 'На каком основании',
    body:
      'На основании вашего согласия. Вы даёте его, когда нажимаете кнопку «Отправить» под формой, — до этого нажатия ни одно поле никуда не уходит. Это согласие в смысле пункта 1 части 1 статьи 6 Федерального закона № 152-ФЗ «О персональных данных». Не хотите его давать — не отправляйте форму: квиз при этом работает и стоимость показывает.',
  },
  {
    title: 'Яндекс Метрика и Вебвизор',
    body: `На сайте работает счётчик Яндекс Метрики № ${COUNTER}. Он собирает обезличенные данные о посещении: устройство, браузер, регион, источник перехода, какие экраны квиза вы прошли. В счётчике включены три вещи, о которых стоит сказать прямо:`,
    items: [
      {
        label: 'Вебвизор',
        text:
          'записывает ваши действия на странице — движение указателя, прокрутку, нажатия, переходы между вопросами. Мы смотрим эти записи ради одного: понять, на каком вопросе люди уходят и что в нём непонятно.',
      },
      {
        label: 'Карта кликов',
        text: 'показывает, по каким местам страницы нажимают чаще.',
      },
      {
        label: 'Точный показатель отказов',
        text: 'отличает человека, который прочитал страницу, от того, кто закрыл её сразу.',
      },
    ],
    after:
      'Метрика ставит в браузере свои cookie. Яндекс здесь — обработчик: он обрабатывает данные по нашему поручению и на своих условиях, опубликованных на его сайте. Отказаться можно, не обращаясь к нам: у Яндекса есть страница отключения Метрики, а cookie запрещаются в настройках браузера. Квиз работает и без счётчика.',
  },
  {
    title: 'Кому передаются',
    body:
      'Никому — кроме двух случаев, и оба технические. Первый: Яндекс Метрика, о ней выше. Второй: заявка приходит владельцу сайта сообщением в Telegram, то есть проходит через серверы Telegram. Больше данные никуда не уходят — их не продают, не передают партнёрам, не публикуют.',
  },
  {
    title: 'Сколько хранятся',
    body: `Заявка хранится, пока идёт работа по вашему обращению. Если работа не началась — ${LEGAL.retention} с момента отправки, потом заявка удаляется. Если вы отозвали согласие раньше, она удаляется в течение ${LEGAL.reaction} с момента обращения. Данные, собранные Метрикой, хранятся на стороне Яндекса по его правилам.`,
  },
  {
    title: 'Как отозвать согласие',
    body: `Напишите письмо на почту, указанную ниже. Ни формы, ни кода из сообщения, ни объяснения причин не потребуется — достаточно назвать телефон или ник, который вы оставляли, чтобы мы поняли, какую заявку удалять. Удалим в течение ${LEGAL.reaction} и ответим, что удалили.`,
  },
  {
    title: 'Ваши права',
    body:
      'Вы можете узнать, какие ваши данные у нас есть и откуда они взялись, потребовать исправить неточные, удалить их, ограничить обработку или отозвать согласие целиком. На любое такое обращение мы отвечаем.',
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
          Здесь написано, кто собирает данные с этой страницы, какие именно,
          зачем они нужны, сколько хранятся и как их удалить. Без тумана:
          одна мысль — одно предложение.
        </p>

        {/* Оператор стоит первым, а не в подвале: человеку, который открыл
            политику, прежде всего нужно понять, с кем он вообще имеет дело. */}
        <section className="mt-10 rounded-[1.1rem] border border-line bg-paper-raised p-6 md:p-7">
          <h2 className="text-[1.15rem] font-medium">Оператор</h2>
          <dl className="mt-4 space-y-2.5 text-[0.98rem] leading-relaxed">
            {[
              ['Кто', LEGAL.operator],
              ['ОГРНИП', LEGAL.ogrnip],
              ['ИНН', LEGAL.inn],
              ['Адрес', LEGAL.address],
            ].map(([label, value]) => (
              <div key={label} className="sm:flex sm:gap-4">
                <dt className="text-ink-faint sm:w-24 sm:shrink-0">{label}</dt>
                <dd className="text-ink-soft">{value}</dd>
              </div>
            ))}
            <div className="sm:flex sm:gap-4">
              <dt className="text-ink-faint sm:w-24 sm:shrink-0">Почта</dt>
              <dd>
                <a
                  href={`mailto:${LEGAL.email}`}
                  className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
                >
                  {LEGAL.email}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <ol className="mt-12 space-y-9">
          {SECTIONS.map((section, index) => (
            <li key={section.title} className="border-t border-line-soft pt-6">
              <span className="figure text-[0.9rem] text-gold">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className="mt-2 text-[1.15rem] font-medium leading-snug">{section.title}</h2>
              {section.body ? (
                <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-soft">{section.body}</p>
              ) : null}
              {section.items ? (
                <div className="mt-3 space-y-2.5">
                  {section.items.map((item) => (
                    <p key={item.label} className="text-[0.98rem] leading-relaxed text-ink-soft">
                      <span className="text-ink">{item.label}</span> — {item.text}
                    </p>
                  ))}
                </div>
              ) : null}
              {section.after ? (
                <p className="mt-3 text-[0.98rem] leading-relaxed text-ink-soft">{section.after}</p>
              ) : null}
            </li>
          ))}

          <li className="border-t border-line-soft pt-6">
            <span className="figure text-[0.9rem] text-gold">
              {String(SECTIONS.length + 1).padStart(2, '0')}
            </span>
            <h2 className="mt-2 text-[1.15rem] font-medium leading-snug">Куда писать</h2>
            <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-soft">
              По любому вопросу об обработке данных — на{' '}
              <a
                href={`mailto:${LEGAL.email}`}
                className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
              >
                {LEGAL.email}
              </a>
              . Почтовый адрес оператора — в блоке выше.
            </p>
          </li>
        </ol>

        <p className="mt-12 border-t border-line pt-6 text-[0.9rem] leading-relaxed text-ink-faint">
          Редакция от {LEGAL.updated}. Если политика изменится, новая редакция
          появится на этой же странице.
        </p>
      </div>
    </main>
  );
}
