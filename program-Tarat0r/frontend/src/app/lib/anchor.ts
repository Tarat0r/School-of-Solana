"use client";

import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import idl from "../../idl/d21_voting.json";
import { Buffer } from "buffer";

// Use the IDL address; fall back to env if you want to override.
const IDL_ADDRESS = (idl as any).address as string;
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? IDL_ADDRESS
);

export function getAnchorProvider(connection: Connection, wallet: AnchorWallet) {
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function getProgram(connection: Connection, wallet: AnchorWallet) {
  const provider = getAnchorProvider(connection, wallet);
  // Anchor ≥0.30: no programId param here; it’s taken from idl.address
  return new Program(idl as Idl, provider);
}

export const u64Le = (n: BN | number | string) => {
  const bn = BN.isBN(n) ? n : new BN(n);
  // returns a Buffer with 8 bytes little-endian
  return Buffer.from(bn.toArrayLike(Buffer, "le", 8));
};

export const u16Le = (n: number) => {
  return Buffer.from(new BN(n).toArrayLike(Buffer, "le", 2));
};
