import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

export const DeliberatePractice = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Method"
        title="What is deliberate practice?"
        subtitle="Deliberate practice is focused, feedback-rich rehearsal designed to improve a specific micro-skill instead of generalized performance."
      />

      <Section title="How we apply it" subtitle="A structured loop that prioritizes clarity and feedback.">
        <div className="space-y-3">
          <p>
            Each task in the Library is designed around a micro-skill: reflection, de-escalation, agenda setting, or another
            clinical competency. You repeat that micro-skill in realistic scenarios, receive targeted feedback, and then repeat
            the loop until the new behavior becomes automatic.
          </p>
          <p>
            The rubric-driven scoring and example comparisons keep practice grounded in measurable behaviors. That means you
            can track the specific dimensions that matter most to your clinical style.
          </p>
        </div>
      </Section>

      <Section title="How to get the most out of it" subtitle="Small habits that compound quickly.">
        <ul className="space-y-3">
          {[
            "Focus on one skill per session to avoid diluting your attention.",
            "Listen to the patient prompt twice before responding to pick up nuance.",
            "Track the same task across multiple sessions and review history weekly.",
            "Use the feedback notes as a checklist for your next attempt."
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-400/10 text-xs font-semibold text-teal-200">
                ✓
              </span>
              <span className="text-sm text-slate-200">{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Callout variant="note" title="Practice with intention">
        Consistency matters more than volume. A focused 10-minute loop, repeated daily, yields more sustainable progress than
        sporadic long sessions.
      </Callout>
    </div>
  );
};
