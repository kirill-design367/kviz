// Единственный источник правды по вопросам квиза.
// Порядок вопросов и текст вариантов менять только вместе с pricing.ts и целями Метрики.

export type OptionId = string;

export type QuizOption = {
  id: OptionId;
  label: string;
};

export type QuizQuestion = {
  id: string;
  /** Собственный номер вопроса. Не меняется, даже если вопрос пропущен. */
  order: number;
  title: string;
  /** Короткая подпись под заголовком. Не обязательна. */
  caption?: string;
  /** Когда вопрос не нужно задавать: ответ уже следует из предыдущих. */
  skipWhen?: (answers: Answers) => boolean;
  options: QuizOption[];
};

export const QUESTIONS: QuizQuestion[] = [
  {
    id: 'task',
    order: 1,
    title: 'Что нужно сделать?',
    options: [
      { id: 'new', label: 'Сайт с нуля' },
      { id: 'redesign', label: 'Переделать существующий' },
      { id: 'shop', label: 'Интернет-магазин' },
      { id: 'unsure', label: 'Пока не определился' },
    ],
  },
  {
    id: 'goal',
    order: 2,
    title: 'Для чего сайт?',
    options: [
      { id: 'sell', label: 'Продавать товары или услуги' },
      { id: 'showcase', label: 'Показать проект и портфолио' },
      { id: 'leads', label: 'Собирать заявки' },
      { id: 'other', label: 'Другое' },
    ],
  },
  {
    id: 'assets',
    order: 3,
    title: 'Что уже есть?',
    options: [
      { id: 'idea', label: 'Только идея' },
      { id: 'brand', label: 'Логотип и фирменный стиль' },
      { id: 'content', label: 'Тексты и фото' },
      { id: 'all', label: 'Есть всё, нужна разработка' },
    ],
  },
  {
    id: 'deadline',
    order: 4,
    title: 'Когда нужен результат?',
    options: [
      { id: 'asap', label: 'Вчера' },
      { id: 'week', label: 'В течение недели' },
      { id: 'month', label: 'В течение месяца' },
      { id: 'two-months', label: 'В течение 1–2 месяцев' },
    ],
  },
  {
    id: 'structure',
    order: 5,
    title: 'Какая структура сайта нужна?',
    /**
     * Вопрос не задаётся тем, кто в первом вопросе выбрал интернет-магазин:
     * структура из этого ответа уже понятна, и спрашивать второй раз значит
     * заставлять человека повторяться. См. visibleQuestions ниже.
     */
    skipWhen: (answers) => answers.task === 'shop',
    options: [
      { id: 'landing', label: 'Лендинг' },
      { id: 'multi', label: 'Многостраничник' },
      { id: 'shop', label: 'Интернет-магазин' },
      { id: 'unknown', label: 'Не знаю' },
    ],
  },
  {
    id: 'priority',
    order: 6,
    title: 'Что важнее?',
    options: [
      { id: 'speed', label: 'Скорость запуска' },
      { id: 'design', label: 'Уникальный дизайн' },
      { id: 'features', label: 'Функциональность' },
      { id: 'price', label: 'Цена' },
    ],
  },
  {
    id: 'budget',
    order: 7,
    title: 'Бюджет на проект',
    caption: 'Не влияет на расчёт ниже — он считается по задаче, а не по бюджету',
    options: [
      { id: 'lt50', label: 'До 50 000 ₽' },
      { id: '50-150', label: '50–150 000 ₽' },
      { id: '150-300', label: '150–300 000 ₽' },
      { id: 'gt300', label: 'Больше 300 000 ₽' },
      { id: 'discuss', label: 'Обсуждается' },
    ],
  },
];

export type Answers = Partial<Record<string, OptionId>>;

/**
 * Вопросы, которые человеку действительно зададут при таких ответах.
 *
 * Список пересчитывается на каждый ответ: выбрал в первом вопросе
 * интернет-магазин — вопрос про структуру выпадает, и в квизе остаётся шесть
 * шагов вместо семи. Прогресс и нумерация считаются по этому списку.
 */
export function visibleQuestions(answers: Answers): QuizQuestion[] {
  return QUESTIONS.filter((q) => !q.skipWhen?.(answers));
}

export function isComplete(answers: Answers): boolean {
  return visibleQuestions(answers).every((q) => Boolean(answers[q.id]));
}

/** Человекочитаемая пара «вопрос — ответ» для письма в Telegram и для отладки. */
export function readableAnswers(answers: Answers): { question: string; answer: string }[] {
  return visibleQuestions(answers).map((q) => ({
    question: q.title,
    answer: q.options.find((o) => o.id === answers[q.id])?.label ?? '—',
  }));
}
