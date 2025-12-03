"use client";

import type { Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

/** Map Anchor + RPC errors to readable text, including custom program codes. */
export function prettyAnchorError(e: any, idl?: Idl): string {
  const code = e?.error?.errorCode?.code as string | undefined;
  const msg = e?.error?.errorMessage as string | undefined;
  if (code && msg) return `${code}: ${msg}`;

  const logs = (e?.logs ?? e?.error?.logs)?.join?.("\n");
  if (logs) {
    const mCode = logs.match(/Error Code:\s*([A-Za-z0-9_]+)/);
    const mMsg  = logs.match(/Error Message:\s*(.+)/);
    if (mCode && mMsg) return `${mCode[1]}: ${mMsg[1]}`;
  }

  // “custom program error: 0xNNNN”
  const mHex = String(e?.message ?? e).match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (mHex) {
    const n = parseInt(mHex[1], 16);
    const entry = (idl as any)?.errors?.find((x: any) => x.code === n);
    if (entry) return `${entry.name}: ${entry.msg}`;
    return `Program error 0x${n.toString(16)} (${n})`;
  }

  // Common RPC messages
  const s = String(e?.message ?? e ?? "");
  if (/Account does not exist|has no data/i.test(s)) return s;

  return s || "Unknown error";
}

/** Throw a descriptive error if an account does not exist. */
export async function requireAccount(
  connection: Connection,
  pubkey: PublicKey,
  label: string
): Promise<void> {
  const ai = await connection.getAccountInfo(pubkey);
  if (!ai) {
    throw new Error(`${label} not found at ${pubkey.toBase58()}. It has not been initialized yet.`);
  }
}
