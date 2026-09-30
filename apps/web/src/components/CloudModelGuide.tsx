import { CLOUD_MODEL_ROLES } from "@deliberate/shared";
import { useTranslation } from "react-i18next";

export const CloudModelGuide = () => {
  const { t } = useTranslation();
  return (
    <section
      className="studio-card p-5 sm:p-8"
      aria-labelledby="cloud-model-guide-title"
    >
      <p className="studio-eyebrow">{t("studio.models.kicker")}</p>
      <h3 id="cloud-model-guide-title" className="mt-2 text-xl font-semibold">
        {t("studio.models.title")}
      </h3>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-teal-300/20 p-4">
          <p className="text-sm font-semibold text-teal-200">
            {CLOUD_MODEL_ROLES.reasoning}
          </p>
          <p className="mt-2 text-sm text-slate-300">
            {t("studio.models.reasoning")}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <p className="text-sm font-semibold text-slate-100">
            {CLOUD_MODEL_ROLES.routine}
          </p>
          <p className="mt-2 text-sm text-slate-300">
            {t("studio.models.routine")}
          </p>
        </div>
      </div>
      <p className="studio-guidance mt-5">{t("studio.models.limit")}</p>
    </section>
  );
};
