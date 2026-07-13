// KingdomOS — Quickstart docs (same-page scroll). Each section pairs a short
// description with a live Remotion animation that visualises the real concept
// (frame-driven, play-once-on-view). Commands & wording mirror packages/cli.
import { DocAnim } from "@/remotion/docs/DocAnim";
import { DOC_COMPACT, type DocAnimId } from "@/remotion/docs/meta";
import type { CSSProperties } from "react";

interface DocSection {
  id: DocAnimId;
  step: string;
  title: string;
  command: string;
  body: React.ReactNode;
}

const SECTIONS: DocSection[] = [
  {
    id: "install",
    step: "01",
    title: "Install",
    command: "curl -fsSL https://kingdomos.dev/install | sh",
    body: (
      <>
        One line installs the <code>kingdom</code> CLI globally. Verify it with{" "}
        <code>kingdom --version</code>.
      </>
    ),
  },
  {
    id: "setup",
    step: "02",
    title: "Set up a kingdom",
    command: "kingdom setup camelot",
    body: (
      <>
        Scaffolds a <code>kingdom/</code> directory — config, the SQLite ledger,
        and the agent court — inside your project. Idempotent; re-run with{" "}
        <code>--force</code> to re-scaffold.
      </>
    ),
  },
  {
    id: "decree",
    step: "03",
    title: "Decree an objective",
    command: 'kingdom decree "Integrate Stripe subscription billing"',
    body: (
      <>
        Queues a high-level objective for the King to decompose. Options:{" "}
        <code>--priority &lt;1-10&gt;</code>, <code>--dry-run</code>, and{" "}
        <code>--criteria &lt;file&gt;</code>.
      </>
    ),
  },
  {
    id: "summon",
    step: "04",
    title: "Summon the court",
    command: "kingdom summon --verbose",
    body: (
      <>
        Wakes the agents — the King plans, Nobility breaks epics into tasks,
        Knights execute, the Judge reviews, the Healer recovers. Requires{" "}
        <code>OPENAI_API_KEY</code> in <code>.env</code>.
      </>
    ),
  },
  {
    id: "status",
    step: "05",
    title: "Watch progress",
    command: "kingdom status",
    body: (
      <>
        A live dashboard of tasks, jobs, token spend, and the current objective.
        Run it any time while the court is at work.
      </>
    ),
  },
];

// `hideIntro` — on the home page the <Bridge> transition already resolves into
// the "From zero to a working kingdom" heading, so the docs section drops its
// own intro to avoid showing it twice.
export function Docs({ hideIntro = false }: { hideIntro?: boolean }) {
  return (
    <section
      className={`docs-root${hideIntro ? " docs-root--bridged" : ""}`}
      id="quickstart"
    >
      {hideIntro ? null : (
        <div className="docs-intro">
          <p className="docs-eyebrow">Quickstart</p>
          <h2 className="docs-title">From zero to a working kingdom</h2>
          <p className="docs-sub">
            Five commands take you from install to a court of agents building
            your objective. Everything runs in your terminal.
          </p>
        </div>
      )}

      <div className="docs-sections">
        {SECTIONS.map((s, i) => (
          <article
            key={s.id}
            id={s.id}
            className={`docs-section${i % 2 === 1 ? " docs-section--rev" : ""}`}
          >
            <div className="docs-copy">
              <div className="docs-section-head">
                <span className="docs-step">{s.step}</span>
                <h3 className="docs-section-title">{s.title}</h3>
              </div>
              <p className="docs-section-body">{s.body}</p>
              <div className="docs-cmd">
                <span className="docs-cmd-prompt">$</span>
                <code>{s.command}</code>
              </div>
            </div>

            <div
              className="docs-anim"
              aria-hidden="true"
              // Phone aspect — matches the per-anim compact canvas so its scaled
              // composition fills the box with no letterboxing (≤600px only, via
              // the CSS var; desktop/tablet keep the base 1000/660 aspect).
              style={
                {
                  "--docs-anim-aspect": `${DOC_COMPACT[s.id].w} / ${DOC_COMPACT[s.id].h}`,
                } as CSSProperties
              }
            >
              <DocAnim id={s.id} />
            </div>
          </article>
        ))}
      </div>

      <footer className="docs-foot">
        <span>
          Full reference &amp; source on{" "}
          <a
            href="https://github.com/oliversl1vka/Kingdom"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/oliversl1vka/Kingdom
          </a>
        </span>
      </footer>
    </section>
  );
}
