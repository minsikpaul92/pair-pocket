"use client";

interface Props {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/** Small top-left label above an onboarding input. */
export default function OnboardingField({ label, children, className = "" }: Props) {
  return (
    <label className={`block space-y-1 min-w-0 ${className}`}>
      <span className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap truncate">
        {label}
      </span>
      {children}
    </label>
  );
}
