import { useTranslation } from "react-i18next";

type LocalizedTextProps = {
  i18nKey: string;
  values?: Record<string, unknown>;
};

export const LocalizedText = ({ i18nKey, values }: LocalizedTextProps) => {
  const { t } = useTranslation();
  return <>{t(i18nKey, values)}</>;
};
