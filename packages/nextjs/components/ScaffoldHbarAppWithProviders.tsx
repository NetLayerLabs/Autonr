"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { Toaster } from "react-hot-toast";
import { hederaTestnet } from "viem/chains";
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { LocalChainErrorBanner } from "~~/components/LocalChainErrorBanner";
import { BlockieAvatar } from "~~/components/scaffold-hbar";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <div className="flex flex-col min-h-screen">
        <Header />
        <LocalChainErrorBanner />
        <main className="relative flex flex-col flex-1">{children}</main>
        <Footer />
      </div>
      <Toaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// The dashboard is dark only, so the wallet modal is too; white accents match the primary buttons.
const rainbowKitTheme = darkTheme({
  accentColor: "#ffffff",
  accentColorForeground: "#000000",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});

export const ScaffoldHbarAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ProgressBar height="2px" color="#ffffff" />
        <RainbowKitProvider avatar={BlockieAvatar} coolMode initialChain={hederaTestnet} theme={rainbowKitTheme}>
          <ScaffoldHbarApp>{children}</ScaffoldHbarApp>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
