'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { looksLikePhone, phoneAsTyped } from '@/lib/phone';
import { looksLikeTelegram, telegramAsTyped } from '@/lib/telegram';
import { GOALS, reachGoal } from '@/lib/metrika';
import { readSource } from '@/lib/storage';
import { readableAnswers, type Answers } from '@/lib/quiz';
import type { PriceEstimate } from '@/lib/pricing';

/**
 * Приёмник заявок. По умолчанию — свой же адрес: сайт и приёмник живут
 * в одном контейнере и отвечают на одном домене, поэтому ни полного адреса,
 * ни CORS не нужно. Переменная остаётся для разработки и для случая,
 * когда приёмник вынесут на отдельный хост.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_LEAD_ENDPOINT || '/api/lead';

type Channel = 'telegram' | 'call';
type Status = 'idle' | 'sending' | 'sent' | 'failed';

type Props = {
  answers: Answers;
  price: PriceEstimate;
  onSent: (channel: Channel) => void;
};

const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'call', label: 'Позвонить' },
  { id: 'telegram', label: 'Написать в Telegram' },
];

export function LeadForm({ answers, price, onSent }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // Ник хранится отдельно от телефона: человек может переключить способ
  // связи туда и обратно, и напечатанное не должно теряться.
  const [nick, setNick] = useState('');
  // По умолчанию звонок: обещание перезвонить за семь минут — основной путь.
  const [channel, setChannel] = useState<Channel>('call');
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<{ name?: string; contact?: string; form?: string }>({});
  const [touched, setTouched] = useState(false);
  /** Защёлка от повторной отправки: состояние React обновляется асинхронно,
      а второй тап по кнопке может прийти в том же кадре. */
  const busy = useRef(false);
  const honeypot = useRef<HTMLInputElement>(null);

  const wantsTelegram = channel === 'telegram';

  const validate = () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Напишите, как к вам обращаться';
    if (wantsTelegram) {
      if (!looksLikeTelegram(nick)) next.contact = 'Это не похоже на ник в Telegram';
    } else if (!looksLikePhone(phone)) {
      next.contact = 'Это не похоже на номер телефона';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (busy.current || status === 'sending' || status === 'sent') return;
    if (!validate()) return;

    busy.current = true;
    setStatus('sending');
    setErrors({});

    const payload = {
      name: name.trim(),
      channel,
      // Уходит ровно то, что человек напечатал, — и только то поле,
      // которое он на самом деле заполнял.
      ...(wantsTelegram
        ? { telegram: telegramAsTyped(nick) }
        : { phone: phoneAsTyped(phone) }),
      company: honeypot.current?.value ?? '',
      answers: readableAnswers(answers),
      // Вилки на экране не было — и в заявке её тоже нет. Отправлять число,
      // которого человек не видел, значит обсуждать с ним разные суммы.
      ...(price.kind === 'range' ? { price: { low: price.low, high: price.high } } : {}),
      source: readSource(),
    };

    try {
      if (!ENDPOINT) throw new Error('адрес приёмника заявок не задан на сборке');
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 429) {
        throw new Error('too_many');
      }
      if (!response.ok) throw new Error(`ответ сервера ${response.status}`);
      setStatus('sent');
      reachGoal(GOALS.leadSent);
      onSent(channel);
    } catch (error) {
      busy.current = false;
      setStatus('failed');
      setErrors({
        form:
          error instanceof Error && error.message === 'too_many'
            ? 'Слишком много заявок с этого адреса. Попробуйте через несколько минут.'
            : 'Не получилось отправить. Проверьте связь и попробуйте ещё раз.',
      });
      reachGoal(GOALS.leadFailed, { reason: String(error) }, false);
    }
  };

  const sending = status === 'sending';

  return (
    <form
      onSubmit={submit}
      noValidate
      className="w-full"
      /* Цель «начал заполнять» — первое касание любого поля или кнопки
         внутри формы. Между «увидел вилку» и «отправил» это единственная
         точка, по которой видно, где человек передумал: посмотрел и ушёл
         или начал печатать и бросил. Событие всплывает, поэтому хватает
         одного обработчика на форму, а reachGoal сам отсекает повторы. */
      onFocusCapture={() => reachGoal(GOALS.formStart)}
      onPointerDownCapture={() => reachGoal(GOALS.formStart)}
    >
      <div className="space-y-3 lg:space-y-4">
        <Field
          id="name"
          label="Как вас зовут"
          error={touched ? errors.name : undefined}
          value={name}
          onChange={setName}
          autoComplete="given-name"
          inputMode="text"
          placeholder="Имя"
          disabled={sending}
        />

        {/* Поле подстраивается под выбранный способ связи: у звонка —
            телефон, у Telegram — ник. Спрашивать телефон у того, кто
            попросил написать в Telegram, незачем. */}
        {wantsTelegram ? (
          <Field
            key="telegram"
            id="telegram"
            label="Ник в Telegram"
            error={touched ? errors.contact : undefined}
            value={nick}
            onChange={setNick}
            autoComplete="off"
            inputMode="text"
            placeholder="@username"
            disabled={sending}
          />
        ) : (
          <Field
            key="phone"
            id="phone"
            label="Телефон"
            error={touched ? errors.contact : undefined}
            value={phone}
            onChange={setPhone}
            autoComplete="tel"
            inputMode="tel"
            type="tel"
            placeholder="Как вам удобно"
            disabled={sending}
          />
        )}

        <fieldset>
          {/* Строка про звонок и Telegram стоит выше — над всей формой,
              сразу под ценой. Здесь остаётся только подпись для
              скринридера, иначе группа кнопок безымянная. */}
          <legend className="sr-only">Как с вами связаться</legend>
          <div className="grid gap-2">
            {CHANNELS.map((item) => {
              const active = channel === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={sending}
                  aria-pressed={active}
                  onClick={() => {
                    setChannel(item.id);
                    // Ошибка от прошлого способа связи к новому полю
                    // отношения не имеет.
                    setErrors((prev) => ({ ...prev, contact: undefined }));
                  }}
                  className={`press relative flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-full border px-5 text-[1rem] font-medium lg:min-h-[58px] lg:text-[1.05rem] ${
                    active
                      ? 'border-ink bg-[color:var(--selected-fill)] text-ink'
                      : 'border-line text-ink-soft hover:border-ink hover:bg-[color:var(--hover-fill)] hover:text-ink'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full border transition-colors duration-150 ${
                      active ? 'border-ink' : 'border-line'
                    }`}
                  >
                    <span
                      className={`h-[7px] w-[7px] rounded-full bg-ink transition-transform duration-200 ease-aurea ${
                        active ? 'scale-100' : 'scale-0'
                      }`}
                    />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {/* Ловушка для ботов: скрыта от человека, но не от автозаполнялок. */}
      <input
        ref={honeypot}
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] h-px w-px opacity-0"
      />

      {errors.form ? (
        <p role="alert" className="mt-6 text-[0.92rem] text-error">
          {errors.form}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={sending || status === 'sent'}
        className="btn mt-4 inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[0.95rem] text-[1.02rem] font-medium text-on-ink disabled:cursor-not-allowed disabled:opacity-70 lg:mt-5 lg:py-[1.1rem] lg:text-[1.08rem]"
      >
        {sending ? 'Отправляю…' : 'Отправить'}
      </button>

      <p className="mt-2.5 text-[0.78rem] leading-snug text-ink-faint">
        Отправляя форму, вы соглашаетесь на{' '}
        <Link
          href="/privacy"
          target="_blank"
          className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
        >
          обработку персональных данных
        </Link>
        .
      </p>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'tel';
  autoComplete?: string;
  disabled?: boolean;
};

function Field({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
  inputMode = 'text',
  autoComplete,
  disabled,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-[0.78rem] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 w-full border-b bg-transparent pb-2.5 pt-1 text-[1.05rem] outline-none transition-colors duration-200 placeholder:text-ink-faint/60 disabled:opacity-60 lg:pb-3 lg:text-[1.12rem] ${
          error ? 'border-error' : 'border-line focus:border-ink'
        }`}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[0.85rem] text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
