// web/src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import { getProgram, PROGRAM_ID, u64Le, u16Le } from "./lib/anchor";
import { requireAccount } from "./lib/errors";

const MAX_TITLE = 64;
const MAX_DESC = 256;

function prettyAnchorError(e: any, idl?: Idl): string {
  const code = e?.error?.errorCode?.code as string | undefined;
  const msg = e?.error?.errorMessage as string | undefined;
  if (code && msg) return `${code}: ${msg}`;
  const logs = (e?.logs ?? e?.error?.logs)?.join?.("\n");
  if (logs) {
    const mCode = logs.match(/Error Code:\s*([A-Za-z0-9_]+)/);
    const mMsg = logs.match(/Error Message:\s*(.+)/);
    if (mCode && mMsg) return `${mCode[1]}: ${mMsg[1]}`;
  }
  const mHex = String(e?.message ?? e).match(
    /custom program error:\s*0x([0-9a-f]+)/i
  );
  if (mHex) {
    const n = parseInt(mHex[1], 16);
    const entry = (idl as any)?.errors?.find((x: any) => x.code === n);
    if (entry) return `${entry.name}: ${entry.msg}`;
    return `Program error ${n}`;
  }
  return e?.message ?? String(e);
}

type UIOption = {
  index: number;
  label: string;
  plus: number;
  minus: number;
  pda: PublicKey;
};

function Banner({
  type,
  children,
  onClose,
}: {
  type: "success" | "error" | "info";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const color =
    type === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : type === "error"
      ? "bg-rose-50 border-rose-200 text-rose-900"
      : "bg-gray-50 border-gray-200 text-gray-900";
  return (
    <div
      className={`text-sm border rounded p-2 flex items-start justify-between ${color}`}
    >
      <div className="break-all pr-2">{children}</div>
      {onClose ? (
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 border rounded bg-white/40"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}

// ---- FIXED: safe WebCrypto helper to avoid TS BufferSource generic mismatch ----
const toArrayBuffer = (view: Uint8Array): ArrayBuffer =>
  view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : (view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      ) as ArrayBuffer);

export default function Home() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // form state
  const [pollId, setPollId] = useState("101");
  const [title, setTitle] = useState("Demo poll");
  const [desc, setDesc] = useState("description");
  const [plusCredits, setPlusCredits] = useState(2);
  const [minusCredits, setMinusCredits] = useState(1);
  const [startInSec, setStartInSec] = useState(60);
  const [durationSec, setDurationSec] = useState(3600);

  const [newOptionLabel, setNewOptionLabel] = useState("");

  // banners
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  const [options, setOptions] = useState<UIOption[]>([]);
  const [optionsCount, setOptionsCount] = useState(0);

  const program: any = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const pollIdBN = useMemo(() => new BN(pollId || "0"), [pollId]);

  const pollPda: PublicKey | null = useMemo(() => {
    if (!wallet?.publicKey) return null;
    return PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), wallet.publicKey.toBuffer(), u64Le(pollIdBN)],
      PROGRAM_ID
    )[0];
  }, [wallet?.publicKey, pollIdBN]);

  const resetStatus = () => {
    setErr("");
    setOk("");
  };

  // ---- label-guard helpers (match on-chain hashing) ----
  async function labelSeed(label: string): Promise<Uint8Array> {
    const canonical = label.trim().toLowerCase();

    // Prefer WebCrypto in the browser; convert to ArrayBuffer explicitly
    if (typeof window !== "undefined" && globalThis.crypto?.subtle) {
      const data = new TextEncoder().encode(canonical);
      const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
      return new Uint8Array(digest); // 32 bytes
    }

    // Node/SSR fallback
    const { createHash } = await import("crypto");
    const buf = createHash("sha256").update(canonical, "utf8").digest();
    return new Uint8Array(buf); // 32 bytes
  }

  const labelGuardPda = (poll: PublicKey, seed: Uint8Array): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), poll.toBuffer(), Buffer.from(seed)],
      PROGRAM_ID
    )[0];

  // ---- client-side validation to block incorrect vote-type configs ----
  const validationMessage = useMemo(() => {
    if (!title.trim()) return "Title is required.";
    if (title.length > MAX_TITLE) return `Title must be ≤ ${MAX_TITLE} chars.`;
    if (desc.length > MAX_DESC)
      return `Description must be ≤ ${MAX_DESC} chars.`;

    if (!Number.isFinite(plusCredits) || !Number.isInteger(plusCredits))
      return "Plus credits must be an integer.";
    if (!Number.isFinite(minusCredits) || !Number.isInteger(minusCredits))
      return "Minus credits must be an integer.";
    if (plusCredits <= 0) return "Plus credits must be > 0.";
    if (plusCredits > 255 || minusCredits > 255 || minusCredits < 0)
      return "Credits must be within 0..255.";

    // Rule: if minus is used, require P ≥ 2M
    if (minusCredits > 0 && plusCredits < 2 * minusCredits)
      return "Invalid credit ratio. Require plus ≥ 2 × minus.";

    if (!Number.isFinite(startInSec) || startInSec < 0)
      return "Start offset must be ≥ 0 seconds.";
    if (!Number.isFinite(durationSec) || durationSec <= 0)
      return "Duration must be > 0 seconds.";

    return null;
  }, [title, desc, plusCredits, minusCredits, startInSec, durationSec]);

  const ratioHint =
    minusCredits > 0
      ? `Rule: need plus ≥ 2×minus. Current: plus ${plusCredits}, minus ${minusCredits}${
          plusCredits < 2 * minusCredits ? " (violates rule)" : ""
        }`
      : "Minus votes disabled (minus = 0).";

  const refreshPoll = async (verbose = false) => {
    if (!program || !pollPda) return;

    try {
      await requireAccount(connection, pollPda, "Poll account");

      const poll = await program.account.poll.fetch(pollPda);
      const cnt: number = Number(poll.optionsCount ?? poll.options_count ?? 0);
      setOptionsCount(cnt);

      if (cnt === 0) {
        setOptions([]);
      } else {
        const pdas = [...Array(cnt).keys()].map(
          (i) =>
            PublicKey.findProgramAddressSync(
              [Buffer.from("option"), pollPda.toBuffer(), u16Le(i)],
              PROGRAM_ID
            )[0]
        );
        const optAccounts = await program.account.optionNode.fetchMultiple(
          pdas
        );
        const rows = optAccounts
          .map((o: any, i: number) => ({
            index: Number(o.index ?? o["index"]),
            label: String(o.label ?? o["label"]),
            plus: Number(o.plusVotes ?? o["plus_votes"] ?? 0),
            minus: Number(o.minusVotes ?? o["minus_votes"] ?? 0),
            pda: pdas[i],
          }))
          .sort(
            (a: { index: number }, b: { index: number }) => a.index - b.index
          );
        setOptions(rows);
      }
      if (verbose) setOk("Poll refreshed");
    } catch (e: any) {
      const msg = prettyAnchorError(e, program?.idl);
      setErr(msg);
    }
  };

  const initializePoll = async () => {
    resetStatus();
    if (!program || !wallet?.publicKey || !pollPda) return;

    if (validationMessage) {
      setErr(validationMessage);
      return;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const cfg = {
        pollId: pollIdBN,
        title: title.trim(),
        description: desc,
        plusCredits,
        minusCredits,
        startTs: new BN(now + startInSec),
        endTs: new BN(now + startInSec + durationSec),
      };

      const sig = await program.methods
        .initializePoll(cfg)
        .accounts({
          payer: wallet.publicKey,
          authority: wallet.publicKey,
          poll: pollPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setOk(`Poll initialized. Tx: ${sig}`);
      await refreshPoll();
    } catch (e: any) {
      const msg = prettyAnchorError(e, program?.idl);
      setErr(msg);
    }
  };

  const addOption = async () => {
    resetStatus();
    if (!program || !wallet?.publicKey || !pollPda) return;
    const label = newOptionLabel.trim();
    if (!label) {
      setErr("Label is empty");
      return;
    }

    try {
      const index = optionsCount;
      const optionPda = PublicKey.findProgramAddressSync(
        [Buffer.from("option"), pollPda.toBuffer(), u16Le(index)],
        PROGRAM_ID
      )[0];

      // compute canonical label seed and derive label_guard PDA
      const seed = await labelSeed(label); // 32 bytes
      const guard = labelGuardPda(pollPda, seed);

      const sig = await program.methods
        .addOption(index, label, Array.from(seed))
        .accounts({
          authority: wallet.publicKey,
          poll: pollPda,
          optionNode: optionPda,
          labelGuard: guard,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setNewOptionLabel("");
      setOk(`Option #${index} added. Tx: ${sig}`);
      await refreshPoll();
    } catch (e: any) {
      const msg = prettyAnchorError(e, program?.idl);
      setErr(msg);
    }
  };

  useEffect(() => {
    if (program && pollPda) refreshPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, String(pollPda ?? "")]);

  const voteHref =
    hydrated && wallet?.publicKey
      ? `/vote/${wallet.publicKey.toBase58()}/${pollId}`
      : undefined;

  const initDisabled = !!validationMessage;

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">d21-voting</h1>
        {hydrated ? <WalletMultiButton /> : <div style={{ height: 40 }} />}
      </div>

      {err ? (
        <Banner type="error" onClose={() => setErr("")}>
          {err}
        </Banner>
      ) : null}
      {ok ? (
        <Banner type="success" onClose={() => setOk("")}>
          {ok}
        </Banner>
      ) : null}

      <section className="space-y-3 border p-4 rounded-lg">
        <h2 className="font-medium">Initialize poll</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-1">
            <div className="text-sm">Poll ID</div>
            <input
              className="border p-2 w-full"
              value={pollId}
              onChange={(e) => setPollId(e.target.value)}
              placeholder="numeric string"
            />
          </label>
          <label>
            <div className="text-sm">Title</div>
            <input
              className="border p-2 w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
            />
          </label>
          <label className="col-span-2">
            <div className="text-sm">Description</div>
            <input
              className="border p-2 w-full"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={MAX_DESC}
            />
          </label>
          <label>
            <div className="text-sm">Plus credits</div>
            <input
              type="number"
              className="border p-2 w-full"
              value={plusCredits}
              min={1}
              max={255}
              step={1}
              onChange={(e) => setPlusCredits(Number(e.target.value))}
            />
          </label>
          <label>
            <div className="text-sm">Minus credits</div>
            <input
              type="number"
              className="border p-2 w-full"
              value={minusCredits}
              min={0}
              max={255}
              step={1}
              onChange={(e) => setMinusCredits(Number(e.target.value))}
            />
          </label>
          <div className="col-span-2 text-xs text-gray-700">{ratioHint}</div>
          <label>
            <div className="text-sm">Start in (sec)</div>
            <input
              type="number"
              className="border p-2 w-full"
              value={startInSec}
              min={0}
              step={1}
              onChange={(e) => setStartInSec(Number(e.target.value))}
            />
          </label>
          <label>
            <div className="text-sm">Duration (sec)</div>
            <input
              type="number"
              className="border p-2 w-full"
              value={durationSec}
              min={1}
              step={1}
              onChange={(e) => setDurationSec(Number(e.target.value))}
            />
          </label>
        </div>

        {validationMessage ? (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
            {validationMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={initializePoll}
            className={`px-3 py-2 text-white rounded ${
              initDisabled ? "bg-gray-300 cursor-not-allowed" : "bg-black"
            }`}
            disabled={initDisabled}
            title={initDisabled ? validationMessage ?? "" : "Create poll"}
          >
            Create poll
          </button>
          <button
            onClick={() => refreshPoll(true)}
            className="px-3 py-2 bg-gray-200 rounded"
          >
            Refresh
          </button>
          {voteHref && (
            <Link
              href={voteHref}
              className="px-3 py-2 bg-indigo-600 text-white rounded"
            >
              Open voting page
            </Link>
          )}
        </div>

        <div className="text-xs text-gray-600 mt-2">
          Program: {PROGRAM_ID.toBase58()}
          {pollPda && <> • Poll PDA: {pollPda.toBase58()}</>}
        </div>
      </section>

      <section className="space-y-3 border p-4 rounded-lg">
        <h2 className="font-medium">Add option</h2>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2">
            <div className="text-sm">Label</div>
            <input
              className="border p-2 w-full"
              value={newOptionLabel}
              onChange={(e) => setNewOptionLabel(e.target.value)}
              placeholder="e.g., Option A"
              maxLength={64}
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={addOption}
              className="px-3 py-2 bg-indigo-600 text-white rounded w-full"
            >
              Add (index {optionsCount})
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {options.map((opt) => (
            <div
              key={opt.index}
              className="flex items-center justify-between border p-3 rounded"
            >
              <div className="flex-1">
                <div className="font-medium">
                  #{opt.index} {opt.label}
                </div>
                <div className="text-sm text-gray-700">
                  +{opt.plus} / −{opt.minus}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
