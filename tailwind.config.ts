import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      xs: '400px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      colors: {
        paper: 'var(--paper)',
        'paper-raised': 'var(--paper-raised)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        'ink-faint': 'var(--ink-faint)',
        line: 'var(--line)',
        'line-soft': 'var(--line-soft)',
        gold: 'var(--gold)',
        'gold-soft': 'var(--gold-soft)',
        'on-ink': 'var(--on-ink)',
        'on-ink-soft': 'var(--on-ink-soft)',
        error: 'var(--error)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },
      maxWidth: {
        column: '35rem',
        wide: '68rem',
      },
      transitionTimingFunction: {
        aurea: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
