import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en/common.json";
import fr from "./locales/fr/common.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      fr: { common: fr }
    },
    fallbackLng: "en",
    supportedLngs: ["en", "fr"],
    defaultNS: "common",
    ns: ["common"],
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"]
    },
    react: {
      useSuspense: false
    }
  });

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

i18n.on("initialized", () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
});

export default i18n;
