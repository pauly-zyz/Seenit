import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { config } from "../config";
import { createApi, type SeenitApi } from "../lib/api";
import { buildSiweMessage } from "../lib/siwe";

const KEY = "seenit.session";

export interface Session {
  token: string;
  wallet: string;
  expiresAt: string;
}

interface SessionValue {
  status: "loading" | "signedOut" | "signedIn";
  session: Session | null;
  api: SeenitApi;
  /** SIWE: get a nonce, have the wallet sign, exchange for a session token. */
  signIn(address: `0x${string}`, signMessage: (message: string) => Promise<string>): Promise<void>;
  signOut(): Promise<void>;
}

function createTokenStore() {
  let value: string | null = null;
  return { get: () => value, set: (v: string | null) => void (value = v) };
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  children,
  api: injectedApi,
}: {
  children: React.ReactNode;
  /** Tests inject a fake API. */
  api?: SeenitApi;
}) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [session, setSession] = useState<Session | null>(null);
  // Read by the API client on each request; lives outside React state on purpose.
  const [token] = useState(createTokenStore);
  const api = useMemo(
    () => injectedApi ?? createApi({ baseUrl: config.apiUrl, getToken: token.get }),
    [injectedApi, token],
  );

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        if (cancelled) return;
        const saved = raw ? (JSON.parse(raw) as Session) : null;
        if (saved && new Date(saved.expiresAt).getTime() > Date.now()) {
          token.set(saved.token);
          setSession(saved);
          setStatus("signedIn");
        } else {
          setStatus("signedOut");
        }
      })
      .catch(() => !cancelled && setStatus("signedOut"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signIn = useCallback<SessionValue["signIn"]>(
    async (address, signMessage) => {
      const { nonce, domain, chainId } = await api.getNonce();
      const message = buildSiweMessage({
        address,
        nonce,
        domain,
        chainId,
        uri: config.apiUrl,
        issuedAt: new Date(),
      });
      const signature = await signMessage(message);
      const res = await api.verifySiwe(message, signature);
      const next: Session = { token: res.token, wallet: res.user.wallet, expiresAt: res.expiresAt };
      await SecureStore.setItemAsync(KEY, JSON.stringify(next));
      token.set(next.token);
      setSession(next);
      setStatus("signedIn");
    },
    [api, token],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Offline or already expired: forget it locally anyway.
    }
    await SecureStore.deleteItemAsync(KEY);
    token.set(null);
    setSession(null);
    setStatus("signedOut");
  }, [api, token]);

  const value = useMemo(
    () => ({ status, session, api, signIn, signOut }),
    [status, session, api, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
