"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import type { WalletActions } from "@/lib/dashboard/funding";
import type { Meta } from "@/lib/dashboard/types";

import { FundMission } from "./fund-mission";
import { MissionForm } from "./mission-form";
import { useDashboardApi } from "./providers";
import { errorMessage, Notice } from "./ui";

/** Form → draft mission (API) → fund from the wallet → mission page. */
export function NewMission({ meta, wallet }: { meta: Meta; wallet: WalletActions | null }) {
  const api = useDashboardApi();
  const router = useRouter();
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.templates(),
    staleTime: Infinity,
  });
  const create = useMutation({
    mutationFn: (spec: Record<string, unknown>) => api.createMission(spec),
  });

  if (templates.isPending) return <p className="text-muted">Loading templates…</p>;
  if (templates.isError) return <Notice tone="error">{errorMessage(templates.error)}</Notice>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New mission</h1>
        <p className="text-sm text-muted">
          Verified people near the spot capture it in the app; you get a structured answer per
          capture.
        </p>
      </div>
      {create.data ? (
        <FundMission
          api={api}
          wallet={wallet}
          mission={create.data.mission}
          funding={create.data.funding}
          meta={meta}
          onLive={(m) => {
            void qc.invalidateQueries({ queryKey: ["missions"] });
            router.push(`/dashboard/missions/${m.id}`);
          }}
        />
      ) : (
        <>
          {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
          <MissionForm
            meta={meta}
            templates={templates.data.templates}
            busy={create.isPending}
            onSubmit={(spec) => create.mutate(spec)}
          />
        </>
      )}
    </div>
  );
}
