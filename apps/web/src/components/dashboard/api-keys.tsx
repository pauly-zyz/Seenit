"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { dateTime } from "@/lib/dashboard/format";

import { useDashboardApi } from "./providers";
import { Badge, Button, Card, errorMessage, Field, inputClass, Notice } from "./ui";

export function ApiKeys() {
  const api = useDashboardApi();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api.apiKeys() });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (n: string) => api.createApiKey(n),
    onSuccess: (r) => {
      setCreated({ name: r.name, key: r.key });
      setName("");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted">
          Keys let agents, the SDK and the MCP server create and manage missions for this account.
          Treat them like passwords.
        </p>
      </div>

      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <div className="flex-1">
            <Field
              label="Key name"
              htmlFor="key-name"
              hint="Where it's used, e.g. “research agent”."
            >
              <input
                id="key-name"
                className={inputClass}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" busy={create.isPending} disabled={!name.trim()} className="sm:mb-6">
            Create key
          </Button>
        </form>
      </Card>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {created ? (
        <Notice tone="success">
          <p className="font-medium">
            Key “{created.name}” created. Copy it now: it won’t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code
              data-testid="new-key"
              className="flex-1 overflow-x-auto rounded-lg bg-code px-3 py-2 font-mono text-xs text-tok-plain"
            >
              {created.key}
            </code>
            <CopyButton text={created.key} />
          </div>
        </Notice>
      ) : null}

      {keys.isPending ? (
        <p className="text-muted">Loading keys…</p>
      ) : keys.isError ? (
        <Notice tone="error">{errorMessage(keys.error)}</Notice>
      ) : keys.data.keys.length === 0 ? (
        <p className="text-sm text-muted">No keys yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.data.keys.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.prefix}…</td>
                  <td className="px-4 py-3 text-xs">{dateTime(k.createdAt)}</td>
                  <td className="px-4 py-3 text-xs">
                    {k.lastUsedAt ? dateTime(k.lastUsedAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {k.revokedAt ? (
                      <Badge>Revoked</Badge>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        busy={revoke.isPending && revoke.variables === k.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke “${k.name}”? Anything using it stops working immediately.`,
                            )
                          )
                            revoke.mutate(k.id);
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
