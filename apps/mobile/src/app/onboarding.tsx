import { useAccount, useAppKit, useProvider } from "@reown/appkit-react-native";
import { useMemo } from "react";
import { stringToHex } from "viem";

import { config } from "../config";
import { walletConfigured } from "../lib/wallet";
import { useSession } from "../providers/session";
import { OnboardingScreen, type WalletControls } from "../screens/OnboardingScreen";

export default function Onboarding() {
  const { signIn } = useSession();
  const { address, isConnected } = useAccount();
  const { provider } = useProvider();
  const { open, disconnect } = useAppKit();

  const wallet = useMemo<WalletControls>(
    () => ({
      configured: walletConfigured,
      address: address as `0x${string}` | undefined,
      isConnected,
      open: () => open(),
      disconnect: () => disconnect(),
      async signMessage(message) {
        if (!provider || !address) throw new Error("Wallet not connected");
        // EIP-191 personal_sign through the connected WalletConnect session.
        return provider.request<string>(
          { method: "personal_sign", params: [stringToHex(message), address] },
          `eip155:${config.chainId}`,
        );
      },
    }),
    [address, isConnected, provider, open, disconnect],
  );

  return <OnboardingScreen wallet={wallet} onSignIn={signIn} />;
}
