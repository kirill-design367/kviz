export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-display text-[1.35rem] leading-none tracking-[0.22em] ${className}`}
      aria-label="AUREA"
    >
      AUREA
    </span>
  );
}
