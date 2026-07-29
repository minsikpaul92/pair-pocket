"use client";

import LanguagePicker from "@/components/LanguagePicker";

interface Props {
  className?: string;
}

/** Compact KO/EN toggle used in the main app chrome. */
export default function LocaleToggle({ className = "" }: Props) {
  return <LanguagePicker variant="toggle" className={className} />;
}
