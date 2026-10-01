export type AuthEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};
export type AuthEmailSender = (message: AuthEmail) => Promise<void>;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function authEmail(
  to: string,
  url: string,
  kind: "verification" | "reset",
  language: "en" | "fr",
): AuthEmail {
  const copy =
    language === "fr"
      ? kind === "verification"
        ? [
            "Confirmez votre adresse e-mail",
            "Confirmez votre adresse pour accéder à votre espace de pratique.",
            "Confirmer mon adresse",
          ]
        : [
            "Choisissez un nouveau mot de passe",
            "Vous avez demandé un nouveau mot de passe pour votre espace de pratique.",
            "Changer mon mot de passe",
          ]
      : kind === "verification"
        ? [
            "Confirm your email address",
            "Confirm your address to access your practice space.",
            "Confirm my address",
          ]
        : [
            "Choose a new password",
            "You requested a new password for your practice space.",
            "Change my password",
          ];
  const note =
    language === "fr"
      ? "Si vous n’avez pas fait cette demande, ignorez ce message."
      : "If you did not request this, ignore this message.";
  return {
    to,
    subject: `Therapy Studio · ${copy[0]}`,
    text: `${copy[1]}\n\n${url}\n\n${note}`,
    html: `<div style="background:#F4F1EA;color:#0D2025;padding:32px;font-family:system-ui,sans-serif;line-height:1.6"><p>THERAPY STUDIO</p><h1>${copy[0]}</h1><p>${copy[1]}</p><p><a style="display:inline-block;background:#163137;color:#F4F1EA;padding:12px 20px;border-radius:24px" href="${escapeHtml(url)}">${copy[2]}</a></p><p>${note}</p></div>`,
  };
}
