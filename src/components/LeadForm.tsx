'use client';

import { useRef, useState } from 'react';
import { formatPhone, isValidPhone, normalizePhone } from '@/lib/phone';
import { GOALS, reachGoal } from '@/lib/metrika';
import { readSource } from '@/lib/storage';
import { readableAnswers, type Answers } from '@/lib/quiz';
import type { PriceRange } from '@/lib/pricing';

const ENDPOINT = process.env.NEXT_PUBLIC_LEAD_ENDPOINT ?? '';

type Channel = 'telegram' | 'call';
type Status = 'idle' | 'sending' | 'sent' | 'failed';

type Props = {
  answers: Answers;
  price: PriceRange;
  onSent: () => void;
};

const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: 'telegram', label: 'Telegram', hint: 'напишу в мессенджер' },
  { id: 'call', label: 'Звонок', hint: 'наберу по телефону' },
];

export function LeadForm({ answers, price, onSent }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<Channel>('telegram');
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; form?: string }>({});
  const [touched, setTouched] = useState(false);
  /** Защёлка от повторной отправки: состояние React обновляется асинхронно,
      а второй тап по кнопке может прийти в том же кадре. */
  const busy = useRef(false);
  const honeypot = useRef<HTMLInputElement>(null);

  const validate = () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Напишите, как к вам обращаться';
    if (!isValidPhone(phone)) next.phone = 'Проверьте номер: нужно десять цифр после +7';
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
      phone: normalizePhone(phone),
      channel,
      company: honeypot.current?.value ?? '',
      answers: readableAnswers(answers),
      price: { low: price.low, high: price.high },
      source: readSource(),
    };

    try {
      if (!ENDPOINT) throw new Error('адрес приёмника заявок не задан на сборке');
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`ответ сервера ${response.status}`);
      setStatus('sent');
      reachGoal(GOALS.leadSent);
      onSent();
    } catch (error) {
      busy.current = false;
      setStatus('failed');
      setErrors({
        form: 'Не получилось отправить. Проверьте связь и попробуйте ещё раз.',
      });
      reachGoal(GOALS.leadFailed, { reason: String(error) }, false);
    }
  };

  const sending = status === 'sending';

  return (
    <form onSubmit={submit} noValidate className="max-w-column">
      <h2 className="text-[1.5rem] font-medium leading-snug tracking-[-0.01em] sm:text-[1.8rem]">
        Точный расчёт и работы под вашу задачу
      </h2>
      <p className="mt-3 text-[0.98rem] leading-relaxed text-on-ink-soft">
        Разберу вашу задачу подробнее, посчитаю точную сумму и пришлю несколько
        работ, близких к тому, что нужно вам.
      </p>

      <div className="mt-8 space-y-5">
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

        <Field
          id="phone"
          label="Телефон"
          error={touched ? errors.phone : undefined}
          value={phone}
          onChange={(v) => setPhone(formatPhone(v))}
          autoComplete="tel"
          inputMode="tel"
          type="tel"
          placeholder="+7 900 000-00-00"
          disabled={sending}
        />

        <fieldset>
          <legend className="text-[0.78rem] uppercase tracking-[0.14em] text-on-ink-soft">
            Куда ответить
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {CHANNELS.map((item) => {
              const active = channel === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={sending}
                  aria-pressed={active}
                  onClick={() => setChannel(item.id)}
                  className={`rounded-2xl border px-4 py-4 text-left transition-colors duration-200 ${
                    active
                      ? 'border-on-ink bg-on-ink/10 text-on-ink'
                      : 'border-on-ink-soft/35 text-on-ink-soft hover:border-on-ink-soft'
                  }`}
                >
                  <span className="block text-[1rem] font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-[0.82rem] text-on-ink-soft">{item.hint}</span>
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
        <p role="alert" className="mt-6 text-[0.92rem] text-gold-soft">
          {errors.form}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={sending || status === 'sent'}
        className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-on-ink px-8 py-[1.15rem] text-[1.05rem] font-medium text-ink transition-transform duration-300 ease-aurea will-change-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 sm:w-auto sm:px-11"
      >
        {sending ? 'Отправляю…' : 'Отправить'}
      </button>

      <p className="mt-5 text-[0.92rem] leading-relaxed text-on-ink-soft">
        Перезвоню в течение семи минут в рабочее время. Телефон нужен только
        для ответа по этой заявке — никаких рассылок.
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
      <label
        htmlFor={id}
        className="block text-[0.78rem] uppercase tracking-[0.14em] text-on-ink-soft"
      >
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
        className={`mt-2 w-full border-b bg-transparent pb-3 pt-1 text-[1.15rem] outline-none transition-colors duration-200 placeholder:text-on-ink-soft/60 disabled:opacity-60 ${
          error ? 'border-gold-soft' : 'border-on-ink-soft/40 focus:border-on-ink'
        }`}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[0.85rem] text-gold-soft">
          {error}
        </p>
      ) : null}
    </div>
  );
}
