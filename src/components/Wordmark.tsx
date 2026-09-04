export function Wordmark({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={style}
      className={`font-display text-[1.35rem] leading-none tracking-[0.22em] ${className}`}
      aria-label="AUREA"
    >
      AUREA
    </span>
  );
}
