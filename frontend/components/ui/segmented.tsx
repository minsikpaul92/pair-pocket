"use client";

interface SegmentedProps<T extends string> {
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/** A few short choices as separate buttons. Use Dropdown for longer lists. */
export default function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-xl border px-2 h-12 text-sm font-semibold shadow-sm transition-all duration-100 enabled:active:translate-y-px enabled:active:scale-95 enabled:active:shadow-none disabled:cursor-not-allowed ${
            value === o.value
              ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500"
              : "border-gray-200 bg-white text-gray-600 enabled:hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:enabled:hover:bg-gray-700"
          } ${disabled && value !== o.value ? "opacity-50" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
