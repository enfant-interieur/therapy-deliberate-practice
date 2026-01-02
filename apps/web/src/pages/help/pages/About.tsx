import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

export const About = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="About"
        title="Therapy Studio"
        subtitle="A deliberate practice environment for therapists who want consistent, actionable feedback between supervision sessions."
      />

      <Section title="Product statement" subtitle="Built for clarity, repeatability, and autonomy.">
        <div className="space-y-3">
          <p>
            Therapy Studio blends guided simulations with structured evaluation so practitioners can rehearse difficult moments
            before they happen in real client care. Every session keeps you in control of the AI stack, the content, and the
            pace of practice.
          </p>
          <p>
            The experience is designed to feel premium and focused: a calm environment for reflection, with clear next steps
            and measurable progress.
          </p>
        </div>
      </Section>

      <Section title="Data + privacy" subtitle="High-level posture and transparency.">
        <ul className="space-y-3 text-sm text-slate-200">
          <li className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            Audio and transcripts are only stored if you enable session storage in Settings.
          </li>
          <li className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            API keys are stored securely and are never returned to the browser after saving.
          </li>
          <li className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            Local inference keeps processing on your machine when you choose the local stack.
          </li>
        </ul>
      </Section>

      <Callout variant="tip" title="Looking for version info?">
        Build details are available from your deployment environment. If you need a specific build hash, check your hosting
        dashboard or release notes.
      </Callout>
    </div>
  );
};
