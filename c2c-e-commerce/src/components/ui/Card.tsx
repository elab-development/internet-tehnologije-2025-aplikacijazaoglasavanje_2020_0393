import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardProps = {
  image?: string;
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
        "flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm",
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
      {image ? (
        <div className="relative h-48 w-full shrink-0 bg-zinc-100">
          <Image
            src={image}
            alt={title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 400px"
          />
          {badge && (
            <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
              {badge}
            </span>
          )}
        </div>
      ) : badge ? (
        <div className="px-4 pt-4">
          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        </div>
      ) : null}

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="line-clamp-2 font-semibold text-zinc-900">{title}</h3>
        {description && (
          <p className="line-clamp-3 flex-1 text-sm text-zinc-500">
            {description}
          </p>
        )}
      </div>

      {/* Footer slot */}
      {footer && (
        <div className="border-t border-zinc-100 px-4 py-3">{footer}</div>
      )}
    </div>
  );
}
