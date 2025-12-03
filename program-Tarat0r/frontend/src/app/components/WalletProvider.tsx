"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { clusterApiUrl } from "@solana/web3.js";

export default function WalletContextProvider({ children }: { children: ReactNode }) {
  const envEndpoint = process.env.NEXT_PUBLIC_SOLANA_RPC;
  const endpoint = typeof envEndpoint === "string" && /^https?:/i.test(envEndpoint)
    ? envEndpoint
    : clusterApiUrl(WalletAdapterNetwork.Devnet);
  const wallets = useMemo(
    () =>
      typeof window === "undefined"
        ? []
        : [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet })],
    []
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
