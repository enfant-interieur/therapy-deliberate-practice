import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

const steps = [
  {
    title: "Select a task",
    description: "Pick a scenario from the Library that aligns with the micro-skill you want to practice."
  },
  {
    title: "Generate the patient prompt",
    description: "The system delivers the simulated patient prompt via text or TTS, using local or OpenAI services."
  },
  {
    title: "Record your response",
    description: "Speak or type your reply. The session captures audio and transcript data for evaluation."
  },
  {
    title: "Evaluate against criteria",
    description: "Your response is scored against the rubric and compared to example benchmarks for the task."
  },
  {
    title: "Review feedback",
    description: "Coaching highlights, rubric scoring, and improvement notes are surfaced in a single view."
  },
  {
    title: "Track progress",
    description: "Sessions are saved in History so you can monitor growth and revisit coaching moments."
  }
];

export const HowItWorks = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="System flow"
        title="What the app is doing"
        subtitle="Every practice session follows a predictable loop so you can focus on the skill, not the tooling."
      />

      <Section title="End-to-end flow" subtitle="From task selection to performance insights.">
        <div className="space-y-5">
          {steps.map((step, index) => (
            <div key={step.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 text-sm font-semibold text-teal-200">
                  {index + 1}
                </span>
                {index < steps.length - 1 ? <span className="mt-2 h-full w-px bg-white/10" /> : null}
              </div>
              <div className="pb-6">
                <h3 className="text-base font-semibold text-white">{step.title}</h3>
                <p className="mt-1 text-sm text-slate-300">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Signals that influence scoring" subtitle="The evaluation balances clarity, empathy, and adherence.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "Rubric criteria defined by the task author",
            "Tone, pacing, and clinical intent extracted from your response",
            "Alignment with example answers across difficulty levels",
            "Session context, including task objectives and skill domain"
          ].map((item) => (
            <li key={item} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200">
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Callout variant="tip" title="Want deeper diagnostics?">
        Save a few sessions for the same task. The History view makes it easy to compare how your scoring shifts as you
        iterate on the same micro-skill.
      </Callout>
    </div>
  );
};
