"use client";

import { useParams } from "next/navigation";

import { ApiKeys } from "./api-keys";
import { AuthGate } from "./auth-gate";
import { MissionReview } from "./mission-review";
import { MissionsList } from "./missions-list";
import { NewMission } from "./new-mission";
import { DashboardShell } from "./shell";
import { useWalletActions } from "./use-wallet";

type View = "missions" | "new" | "mission" | "keys";

/** Client entry for every /dashboard page: sign-in gate, shell, then the view. */
export function DashboardApp({ view }: { view: View }) {
  const wallet = useWalletActions();
  const params = useParams<{ id?: string }>();
  return (
    <AuthGate>
      {({ funder, meta }) => (
        <DashboardShell funder={funder}>
          {view === "missions" ? <MissionsList /> : null}
          {view === "new" ? <NewMission meta={meta} wallet={wallet} /> : null}
          {view === "mission" && params.id ? (
            <MissionReview missionId={params.id} meta={meta} wallet={wallet} />
          ) : null}
          {view === "keys" ? <ApiKeys /> : null}
        </DashboardShell>
      )}
    </AuthGate>
  );
}
