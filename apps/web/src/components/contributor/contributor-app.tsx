"use client";

import { useParams } from "next/navigation";

import { ContributorGate } from "./gate";
import { HistoryView } from "./history-view";
import { MissionView } from "./mission-view";
import { MissionsView } from "./missions-view";
import { ContributorShell } from "./shell";
import { VerifyView } from "./verify-view";

type View = "missions" | "mission" | "verify" | "history";

/** Client entry for every /app page: sign-in gate, shell, then the view. */
export function ContributorApp({ view }: { view: View }) {
  const params = useParams<{ id?: string }>();
  return (
    <ContributorGate>
      {(me) => (
        <ContributorShell me={me}>
          {view === "missions" ? <MissionsView me={me} /> : null}
          {view === "mission" && params.id ? <MissionView id={params.id} me={me} /> : null}
          {view === "verify" ? <VerifyView me={me} /> : null}
          {view === "history" ? <HistoryView /> : null}
        </ContributorShell>
      )}
    </ContributorGate>
  );
}
