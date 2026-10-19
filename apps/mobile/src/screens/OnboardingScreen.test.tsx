import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { OnboardingScreen, type WalletControls } from "./OnboardingScreen";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function wallet(over: Partial<WalletControls> = {}): WalletControls {
  return {
    configured: true,
    isConnected: false,
    open: jest.fn(),
    disconnect: jest.fn(),
    signMessage: jest.fn().mockResolvedValue("0xsig"),
    ...over,
  };
}

describe("OnboardingScreen", () => {
  it("connects a wallet", async () => {
    const w = wallet();
    await render(<OnboardingScreen wallet={w} onSignIn={jest.fn()} />);
    await fireEvent.press(screen.getByText("Connect wallet"));
    expect(w.open).toHaveBeenCalled();
  });

  it("signs in with Ethereum once connected", async () => {
    const w = wallet({ isConnected: true, address: ADDRESS });
    const onSignIn = jest.fn().mockResolvedValue(undefined);
    await render(<OnboardingScreen wallet={w} onSignIn={onSignIn} />);
    expect(screen.getByText("0x1111…1111")).toBeTruthy();
    await fireEvent.press(screen.getByText("Sign in with Ethereum"));
    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith(ADDRESS, w.signMessage));
  });

  it("explains a rejected signature", async () => {
    const onSignIn = jest.fn().mockRejectedValue(new Error("User rejected the request"));
    await render(
      <OnboardingScreen
        wallet={wallet({ isConnected: true, address: ADDRESS })}
        onSignIn={onSignIn}
      />,
    );
    await fireEvent.press(screen.getByText("Sign in with Ethereum"));
    expect(await screen.findByText("You cancelled the signature in your wallet.")).toBeTruthy();
  });

  it("warns when the wallet project id is missing", async () => {
    await render(<OnboardingScreen wallet={wallet({ configured: false })} onSignIn={jest.fn()} />);
    expect(screen.getByText(/missing Reown project id/)).toBeTruthy();
    expect(screen.queryByText("Connect wallet")).toBeNull();
  });
});
