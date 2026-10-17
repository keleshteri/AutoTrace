import iconUrl from "../assets/autotrace-icon-128.png";

/** AutoTrace app icon (same artwork as the desktop/installer icons in src-tauri/icons). */
export function AutoTraceLogo({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={iconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
