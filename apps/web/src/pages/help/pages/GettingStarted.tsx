import { Link, useOutletContext } from "react-router-dom";
import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

type HelpContext = {
  openAiSetup?: () => void;
};

export const GettingStarted = () => {
  const { openAiSetup } = useOutletContext<HelpContext>();

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Getting started"
        title="Launch your first practice session"
        subtitle="Get oriented in under five minutes. This portal walks you through the core workflow and gives you quick access to setup tools."
        actions={
          <>
            <button
              type="button"
              onClick={() => openAiSetup?.()}
              className="rounded-full bg-teal-400 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-500/30 transition hover:bg-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              Launch setup wizard
            </button>
            <Link
              to="/settings"
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              Open settings
            </Link>
          </>
        }
      />

      <Section title="What this app is for" subtitle="A premium practice studio built for therapy micro-skills.">
        <div className="space-y-3 text-sm text-slate-200">
          <p>
            Therapy Studio helps you rehearse high-stakes client conversations by simulating realistic scenarios and scoring
            your response against the criteria you care about. Every session is designed to feel intentional, measurable, and
            repeatable.
          </p>
          <p>
            Each practice is centered on a task from the Library. You speak your response, review the AI evaluation, and then
            iterate with purpose. The result is deliberate, evidence-informed growth without the overhead of scheduling a full
            supervision session.
          </p>
        </div>
      </Section>

      <Section title="3-step quick start" subtitle="From selection to feedback in a tight, repeatable loop.">
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Choose a task",
              description: "Open the Library, filter by difficulty, and select a task that targets the skill you want to build."
            },
            {
              title: "Configure your AI",
              description: "Run local services or connect OpenAI. The setup wizard verifies your stack and keeps you in control."
            },
            {
              title: "Practice + review",
              description: "Run the scenario, speak your response, and review scoring plus coaching highlights in one view."
            }
          ].map((step, index) => (
            <li key={step.title} className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-teal-400/10 text-sm font-semibold text-teal-200">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{step.title}</p>
                  <p className="text-xs text-slate-400">{step.description}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Troubleshooting" subtitle="Quick fixes when setup or playback stalls.">
        <div className="space-y-4">
          <Callout variant="note" title="Local endpoints not responding">
            Confirm the local launcher is running and that the LLM/TTS URLs in Settings match the ports displayed in the
            console. The most common issue is a port mismatch or firewall restriction.
          </Callout>
          <Callout variant="warning" title="Missing OpenAI key">
            If scoring won’t start, verify that the key is saved and validated in Settings. The setup wizard can walk you
            through the full verification flow.
          </Callout>
          <Callout variant="tip" title="Working offline">
            You can still browse the library and review prior sessions while offline. Practice sessions require either local
            inference or a connected OpenAI key.
          </Callout>
        </div>
      </Section>
    </div>
  );
};
