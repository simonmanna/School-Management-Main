import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@/lib/i18n/i18n';

const LABELS: Record<string, string> = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2);
  const idx = SUPPORTED_LOCALES.indexOf(current as any);
  const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void i18n.changeLanguage(next);
      }}
      aria-label="Switch language"
      title={`Current: ${LABELS[current] ?? current.toUpperCase()}`}
      className="hidden gap-1 sm:inline-flex"
    >
      <Globe className="h-4 w-4" />
      <span className="text-xs uppercase">{LABELS[current] ?? current.toUpperCase()}</span>
    </Button>
  );
}
