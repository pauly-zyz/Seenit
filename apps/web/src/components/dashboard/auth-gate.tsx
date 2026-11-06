"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import {
  type Connector,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSignMessage,
} from "wagmi";

import { DashboardApiError } from "@/lib/dashboard/api";
import { shortHex } from "@/lib/dashboard/format";
import type { Funder, Meta } from "@/lib/dashboard/types";

import { useDashboardApi } from "./providers";
import { Button, Card, errorMessage, Notice } from "./ui";

export function useMe() {
  const api = useDashboardApi();
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof DashboardApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

/** Renders children with the signed-in funder, or the wallet sign-in panel. */
export function AuthGate({
  children,
}: {
  children: (me: { funder: Funder; meta: Meta }) => React.ReactNode;
}) {
  const me = useMe();
  if (me.isPending) {
    return <p className="py-20 text-center text-muted">Loading…</p>;
  }
  if (me.isError) return <Notice tone="error">{errorMessage(me.error)}</Notice>;
  if (!me.data) return <SignIn />;
  return <>{children(me.data)}</>;
}

/** A wallet extension announced itself (EIP-6963) or injected window.ethereum. */
function hasBrowserWallet(connectors: readonly Connector[]) {
  return (
    connectors.some((c) => c.id !== "injected") ||
    (typeof window !== "undefined" &&
      "ethereum" in window &&
      Boolean((window as { ethereum?: unknown }).ethereum))
  );
}

/** Funder dashboard sign-in. */
export function SignIn() {
  const api = useDashboardApi();
  const qc = useQueryClient();
  return (
    <WalletSignIn
      eyebrow="Funder dashboard"
      title="Sign in with your wallet"
      body="Your wallet is your account. Missions you fund from it show up here, and it receives any refunds."
      statement="Sign in to the Seenit dashboard. This is free and sends no transaction."
      nonce={api.nonce}
      verify={async (message, signature) => {
        await api.signIn(message, signature);
        await qc.invalidateQueries({ queryKey: ["me"] });
      }}
    />
  );
}

/** Connect a browser wallet, then Sign-In with Ethereum (free, no transaction). */
export function WalletSignIn({
  eyebrow,
  title,
  body,
  statement,
  nonce: getNonce,
  verify,
}: {
  eyebrow: string;
  title: string;
  body: string;
  statement: string;
  nonce: () => Promise<{ nonce: string; domain: string; chainId: number }>;
  verify: (message: string, signature: string) => Promise<void>;
}) {
  const { address, isConnected } = useConnection();
  // EIP-6963 adds one connector per installed wallet at runtime, next to the generic injected one.
  const connectors: readonly Connector[] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const sign = useSignMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const { nonce, domain, chainId } = await getNonce();
      const message = createSiweMessage({
        address,
        chainId,
        domain,
        nonce,
        uri: window.location.origin,
        version: "1",
        statement,
        issuedAt: new Date(),
      });
      const signature = await sign.mutateAsync({ message });
      await verify(message, signature);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md py-16">
      <Card className="flex flex-col gap-4 p-7">
        <div>
          <p className="text-xs font-semibold tracking-widest text-accent-ink uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted">{body}</p>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {isConnected && address ? (
          <>
            <p className="text-sm">
              Connected as <span className="font-mono font-medium">{shortHex(address)}</span>
            </p>
            <Button onClick={signIn} busy={busy}>
              Sign in with Ethereum
            </Button>
            <Button variant="ghost" onClick={() => disconnect.mutate()} disabled={busy}>
              Use another wallet
            </Button>
          </>
        ) : connectors.length === 0 || !hasBrowserWallet(connectors) ? (
          <Notice tone="warn">
            No browser wallet found. Install a wallet extension such as MetaMask or Rabby, or on a
            phone open this page in your wallet app&apos;s browser.
          </Notice>
        ) : (
          <div className="flex flex-col gap-2">
            {connectors.map((c) => (
              <Button
                key={c.uid}
                variant={c === connectors[0] ? "primary" : "ghost"}
                busy={connect.isPending && connect.variables?.connector === c}
                onClick={() =>
                  connect.mutate({ connector: c }, { onError: (e) => setError(errorMessage(e)) })
                }
              >
                {c.id === "injected" ? "Connect browser wallet" : `Connect ${c.name}`}
              </Button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
