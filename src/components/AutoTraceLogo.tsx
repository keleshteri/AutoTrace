/** Inline AutoTrace AT mark — violet path with cyan tip. */
export function AutoTraceLogo({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="#121216" />
      <path
        d="M32 12c-8 0-16 6.5-16 18 0 8.5 5 14 12 16.5V52h8V46.5C43 44 48 38.5 48 30c0-11.5-8-18-16-18z"
        stroke="#8b5cf6"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M22 30h20"
        stroke="#8b5cf6"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M40 46.5c4 1.5 8 4 10 8"
        stroke="#22d3ee"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M46 52l4 2.5-1.5 4.5"
        stroke="#22d3ee"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
