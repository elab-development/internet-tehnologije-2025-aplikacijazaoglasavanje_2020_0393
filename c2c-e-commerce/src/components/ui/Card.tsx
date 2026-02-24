import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardProps = {
  image?: string | null;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  badge?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Card({
  image,
  title,
  description,
  footer,
  onClick,
  className = "",
  badge,
}: CardProps) {
  const isClickable = typeof onClick === "function";

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
      className={[
        "group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm",
        "transition-shadow duration-200",
        isClickable
          ? "cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Image area */}
      <div className="relative h-52 w-full shrink-0 overflow-hidden bg-zinc-100">
        {image ? (
          <Image
            src={image}
            alt={title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 400px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-14 w-14 text-zinc-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
        {badge && (
          <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow">
            {badge}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="line-clamp-2 font-semibold text-zinc-900">{title}</h3>
        {description && (
          <p className="line-clamp-3 flex-1 text-sm text-zinc-500">
            {description}
          </p>
        )}
      </div>

      {/* Footer slot – stop propagation so interactive elements don't trigger card onClick */}
      {footer && (
        <div
          className="border-t border-zinc-100 px-4 py-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
