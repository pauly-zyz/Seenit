import { site } from "@/content/site";
import { escrowTotal, type MissionDraft } from "@/content/use-cases";

import { proofLabel, tierLabel } from "./mission-meta";

/** The mission the agent proposes, shown inside its chat bubble. */
export function DraftCard({ draft }: { draft: MissionDraft }) {
  const rows: Array<[string, string]> = [
    ["Where", `${draft.place} · ${draft.radiusMeters} m`],
    ["Reward", `${draft.reward} ${site.rewardSymbol} × ${draft.slots}`],
    ["Proof", proofLabel(draft)],
    ["Expires", draft.expiresIn],
    ["Who", tierLabel(draft.tier)],
  ];
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
        <span className="font-mono text-[11px] tracking-wider text-muted uppercase">
          Mission draft
        </span>
        <span className="font-mono text-[11px] text-muted">create_mission</span>
      </div>
      <div className="px-3.5 py-3">
        <p className="font-semibold">{draft.title}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-1">
          {draft.answerFields.map((f) => (
            <code key={f} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
              {f}
            </code>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface-2/60 px-3.5 py-2 text-[13px]">
        <span className="text-muted">Escrow total</span>
        <span className="font-semibold">
          {escrowTotal(draft)} {site.rewardSymbol}
        </span>
      </div>
    </div>
  );
}
