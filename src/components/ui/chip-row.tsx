"use client";

/**
 * The row of pills under a search box.
 *
 * Scrolls sideways rather than wrapping: on a phone a wrapped row of six
 * filters is two lines of chrome above the thing somebody came to read, and
 * the sixth filter is worth less than the line it costs.
 */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              active
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground"
            }`}
          >
            {option.label}
            {option.count != null && option.count > 0 && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold ${
                  active ? "bg-background/25" : "bg-primary/15 text-primary"
                }`}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
