import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

const SECTIONS = {
  privacy: ["collect", "use", "share", "storage", "rights", "contact"],
  terms: ["service", "account", "data", "acceptable", "disclaimer", "changes", "contact"],
} as const;

export type LegalKind = keyof typeof SECTIONS;

export default async function LegalPage({ kind }: { kind: LegalKind }) {
  const t = await getTranslations("legal");

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10 text-gray-900 dark:text-gray-100">
      <Link href="/" className="text-sm text-gray-500 hover:underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t(`${kind}.title`)}</h1>
      <p className="mt-1 text-sm text-gray-500">{t("updated")}</p>
      <p className="mt-6 leading-relaxed">{t(`${kind}.intro`)}</p>
      {SECTIONS[kind].map((key) => (
        <section key={key} className="mt-8">
          <h2 className="text-lg font-semibold">{t(`${kind}.sections.${key}.title`)}</h2>
          <p className="mt-2 leading-relaxed">{t(`${kind}.sections.${key}.body`)}</p>
        </section>
      ))}
    </main>
  );
}
