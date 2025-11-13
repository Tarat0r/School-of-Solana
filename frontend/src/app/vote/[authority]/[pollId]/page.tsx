// web/src/app/vote/[authority]/[pollId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import { getProgram, PROGRAM_ID, u64Le, u16Le } from "../../../lib/anchor";
import { requireAccount } from "@/app/lib/errors";

type UIOption = { index: number; label: string; plus: number; minus: number; pda: PublicKey };

// ---- UI helpers ----
function Banner({
  type,
  children,
  onClose,
}: {
  type: "success" | "error" | "info";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const tone =
    type === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : type === "error"
      ? "bg-rose-50 border-rose-200 text-rose-900"
      : "bg-gray-50 border-gray-200 text-gray-900";
  return (
    <div className={`text-sm border rounded p-2 flex items-start justify-between ${tone}`}>
      <div className="break-all pr-2">{children}</div>
      {onClose ? (
        <button onClick={onClose} className="text-xs px-2 py-1 border rounded bg-white/40">
          Close
        </button>
      ) : null}
    </div>
  );
}

function prettyAnchorError(e: any, idl?: any): string {
  const code = e?.error?.errorCode?.code as string | undefined;
  const msg = e?.error?.errorMessage as string | undefined;
  if (code && msg) return `${code}: ${msg}`;

  const logs = (e?.logs ?? e?.error?.logs)?.join?.("\n");
  if (logs) {
    const mCode = logs.match(/Error Code:\s*([A-Za-z0-9_]+)/);
    const mMsg = logs.match(/Error Message:\s*(.+)/);
    if (mCode && mMsg) return `${mCode[1]}: ${mMsg[1]}`;
  }
  const mHex = String(e?.message ?? e).match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (mHex) {
    const n = parseInt(mHex[1], 16);
    const entry = (idl as any)?.errors?.find((x: any) => x.code === n);
    if (entry) return `${entry.name}: ${entry.msg}`;
    return `Program error 0x${n.toString(16)} (${n})`;
  }
  return e?.message ?? String(e);
}

function fmtDuration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function receiptPda(pollPda: PublicKey, voter: PublicKey, index: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), pollPda.toBuffer(), u16Le(index), voter.toBuffer()],
    PROGRAM_ID
  )[0];
}

// ---- Page ----
export default function VotePage() {
  const params = useParams<{ authority: string; pollId: string }>();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // banners
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  // poll meta
  const [pollTitle, setPollTitle] = useState<string>("");
  const [pollDesc, setPollDesc] = useState<string>("");
  const [plusCredits, setPlusCredits] = useState(0);
  const [minusCredits, setMinusCredits] = useState(0);
  const [startTs, setStartTs] = useState<number | null>(null);
  const [endTs, setEndTs] = useState<number | null>(null);

  // voter usage
  const [usedPlus, setUsedPlus] = useState(0);
  const [usedMinus, setUsedMinus] = useState(0);

  // options
  const [options, setOptions] = useState<UIOption[]>([]);
  const [optionsCount, setOptionsCount] = useState(0);

  // options the wallet already voted on (via per-option receipts)
  const [votedIdx, setVotedIdx] = useState<Set<number>>(new Set());

  // time ticker for countdowns
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!hydrated) return;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [hydrated]);

  const [authorityPk, authorityPkErr] = useMemo(() => {
    try {
      return [new PublicKey(params.authority), null] as const;
    } catch {
      return [null, "Invalid authority public key"] as const;
    }
  }, [params.authority]);

  const pollIdBN = useMemo(() => {
    try {
      return new BN(params.pollId);
    } catch {
      return new BN(0);
    }
  }, [params.pollId]);

  const program: any = useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );

  const pollPda: PublicKey | null = useMemo(() => {
    if (!authorityPk) return null;
    return PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authorityPk.toBuffer(), u64Le(pollIdBN)],
      PROGRAM_ID
    )[0];
  }, [authorityPk, pollIdBN]);

  const voterPda = useMemo(() => {
    if (!wallet?.publicKey || !pollPda) return null;
    return PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), pollPda.toBuffer(), wallet.publicKey.toBuffer()],
      PROGRAM_ID
    )[0];
  }, [wallet?.publicKey, pollPda]);

  const resetStatus = () => {
    setErr("");
    setOk("");
  };

  const refreshPoll = async (verbose = false) => {
    if (!program || !pollPda) return;
    try {
      await requireAccount(connection, pollPda, "Poll account");

      const poll = await program.account.poll.fetch(pollPda);
      setPollTitle(String(poll.title ?? poll["title"] ?? ""));
      setPollDesc(String(poll.description ?? poll["description"] ?? ""));
      setPlusCredits(Number(poll.plusCredits ?? poll["plus_credits"] ?? 0));
      setMinusCredits(Number(poll.minusCredits ?? poll["minus_credits"] ?? 0));
      setStartTs(Number(poll.startTs ?? poll["start_ts"] ?? 0));
      setEndTs(Number(poll.endTs ?? poll["end_ts"] ?? 0));

      const cnt: number = Number(poll.optionsCount ?? poll["options_count"] ?? 0);
      setOptionsCount(cnt);

      if (cnt === 0) {
        setOptions([]);
        setVotedIdx(new Set());
      } else {
        const pdas = [...Array(cnt).keys()].map((i) =>
          PublicKey.findProgramAddressSync(
            [Buffer.from("option"), pollPda.toBuffer(), u16Le(i)],
            PROGRAM_ID
          )[0]
        );
        const optAccounts = await program.account.optionNode.fetchMultiple(pdas);
        const rows: UIOption[] = optAccounts
          .map((o: any, i: number) => ({
            index: Number(o.index ?? o["index"]),
            label: String(o.label ?? o["label"]),
            plus: Number(o.plusVotes ?? o["plus_votes"] ?? 0),
            minus: Number(o.minusVotes ?? o["minus_votes"] ?? 0),
            pda: pdas[i],
          }))
          .sort((a: { index: number }, b: { index: number }) => a.index - b.index);
        setOptions(rows);

        // receipts (if your program ever adds them). No-op right now.
        if (wallet?.publicKey) {
          const rPdas = rows.map((o) => receiptPda(pollPda, wallet.publicKey!, o.index));
          const infos = await connection.getMultipleAccountsInfo(rPdas, "confirmed");
          const s = new Set<number>();
          infos.forEach((ai, i) => {
            if (ai) s.add(rows[i].index);
          });
          setVotedIdx(s);
        } else {
          setVotedIdx(new Set());
        }
      }

      // voter usage if wallet connected
      if (voterPda) {
        try {
          const voter = await program.account.voter.fetch(voterPda);
          setUsedPlus(Number(voter.usedPlus ?? voter["used_plus"] ?? 0));
          setUsedMinus(Number(voter.usedMinus ?? voter["used_minus"] ?? 0));
        } catch {
          setUsedPlus(0);
          setUsedMinus(0);
        }
      }

      if (verbose) setOk("Poll refreshed");
    } catch (e: any) {
      setErr(prettyAnchorError(e, program?.idl));
    }
  };

  const castVote = async (opt: UIOption, sentiment: 1 | -1) => {
    resetStatus();
    if (!program || !wallet?.publicKey || !pollPda || !voterPda) return;
    try {
      const receipt = receiptPda(pollPda, wallet.publicKey, opt.index);

      const sig = await program.methods
        .castVote(opt.index, sentiment as any)
        .accounts({
          voterAuthority: wallet.publicKey,
          poll: pollPda,
          optionNode: opt.pda,
          voter: voterPda,
          receipt,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setOk(`Vote submitted. Tx: ${sig}`);
      await refreshPoll();
    } catch (e: any) {
      setErr(prettyAnchorError(e, program?.idl));
    }
  };

  useEffect(() => {
    if (program && pollPda) refreshPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, String(pollPda ?? "")]);

  const totalPlus = options.reduce((s, o) => s + o.plus, 0);
  const totalMinus = options.reduce((s, o) => s + o.minus, 0);

  const remainingPlus = Math.max(0, plusCredits - usedPlus);
  const remainingMinus = Math.max(0, minusCredits - usedMinus);

  const now = nowSec;
  const phase =
    startTs == null || endTs == null
      ? "unknown"
      : now < (startTs ?? 0)
      ? "before"
      : now > (endTs ?? 0)
      ? "after"
      : "open";

  const countdownText =
    !hydrated || startTs == null || endTs == null
      ? ""
      : phase === "before"
      ? `Opens in ${fmtDuration((startTs ?? 0) - now)}`
      : phase === "open"
      ? `Closes in ${fmtDuration((endTs ?? 0) - now)}`
      : `Closed ${fmtDuration(now - (endTs ?? 0))} ago`;

  const votingEnabled =
    phase === "open" && wallet?.publicKey && (remainingPlus > 0 || remainingMinus > 0);

  // ratio gate for minus: require usedPlus >= 2 * (usedMinus + 1)
  const minusAllowedByRatio = usedPlus >= 2 * (usedMinus + 1);

  // ---------- RESULTS / WINNERS ----------
  const rankedByNet = useMemo(() => {
    const rows = options.map((o) => ({
      ...o,
      net: o.plus - o.minus,
    }));
    rows.sort((a, b) => {
      // primary: net desc; secondary: plus desc; tertiary: index asc
      return b.net - a.net || b.plus - a.plus || a.index - b.index;
    });
    return rows;
  }, [options]);

  const bestNet = rankedByNet.length ? rankedByNet[0].net : 0;
  const winners = rankedByNet.filter((r) => r.net === bestNet);

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Vote</h1>
          <div className="text-xs text-gray-600">
            Authority: {params.authority} • Poll ID: {params.pollId}
          </div>
        </div>
        {hydrated ? <WalletMultiButton /> : <div style={{ height: 40 }} />}
      </div>

      {authorityPkErr ? <Banner type="error">{authorityPkErr}</Banner> : null}
      {err ? <Banner type="error" onClose={() => setErr("")}>{err}</Banner> : null}
      {ok ? <Banner type="success" onClose={() => setOk("")}>{ok}</Banner> : null}

      <section className="space-y-3 border p-4 rounded-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-medium">{pollTitle || "Untitled poll"}</h2>
            {pollDesc ? <p className="text-sm text-gray-700 mt-1">{pollDesc}</p> : null}
            <div className="text-xs text-gray-600 mt-2">
              Program: {PROGRAM_ID.toBase58()}
              {pollPda && <> • Poll PDA: {pollPda.toBase58()}</>}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-medium">
              {phase === "before" && "Not started"}
              {phase === "open" && "Open"}
              {phase === "after" && "Closed"}
            </div>
            <div className="text-gray-700">{countdownText}</div>
            {startTs && endTs ? (
              <div className="text-xs text-gray-600 mt-1">
                Start: {new Date((startTs as number) * 1000).toLocaleString()} <br />
                End: {new Date((endTs as number) * 1000).toLocaleString()}
              </div>
            ) : null}
          </div>
        </div>

        <div className="text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            You have: <b>+{plusCredits}</b> / <b>−{minusCredits}</b>
          </div>
          <div className="md:text-right">
            Used: <b>+{usedPlus}</b> / <b>−{usedMinus}</b> • Remaining: <b>+{remainingPlus}</b> / <b>−{remainingMinus}</b>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-600">
            {phase === "open" && !minusAllowedByRatio
              ? "Rule: need two + votes per − vote"
              : null}
          </div>
          <button
            onClick={() => refreshPoll(true)}
            className="px-2 py-1 text-sm border rounded"
          >
            Refresh
          </button>
        </div>
      </section>

      {/* FINAL RESULTS / WINNER SUMMARY */}
      {phase === "after" && (
        <section className="space-y-3 border p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Final results</h3>
            <div className="text-sm text-gray-700">
              Total +: <b>{totalPlus}</b> • Total −: <b>{totalMinus}</b>
            </div>
          </div>

          <div className="text-sm">
            {winners.length === 0 ? (
              <span>No options.</span>
            ) : winners.length === 1 ? (
              <span>
                Winner: <b>{winners[0].label}</b> (net {winners[0].net}, +{winners[0].plus} / −{winners[0].minus})
              </span>
            ) : (
              <span>
                Tie for first between{" "}
                <b>{winners.map((w) => `#${w.index} ${w.label}`).join(", ")}</b> (net {bestNet})
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Rank</th>
                  <th className="py-2 pr-2">Option</th>
                  <th className="py-2 pr-2">+ votes</th>
                  <th className="py-2 pr-2">− votes</th>
                  <th className="py-2 pr-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {rankedByNet.map((r, i) => (
                  <tr
                    key={r.index}
                    className={`border-b last:border-b-0 ${i === 0 ? "bg-amber-50" : ""}`}
                  >
                    <td className="py-2 pr-2">{i + 1}</td>
                    <td className="py-2 pr-2">
                      #{r.index} {r.label}
                    </td>
                    <td className="py-2 pr-2">+{r.plus}</td>
                    <td className="py-2 pr-2">−{r.minus}</td>
                    <td className="py-2 pr-2 font-medium">{r.net}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* OPTIONS LIST / LIVE VIEW */}
      <section className="space-y-3 border p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            {phase === "after" ? "Options (final tallies)" : "Options"}
          </h3>
          <div className="text-sm text-gray-700">
            Total +: <b>{totalPlus}</b> • Total −: <b>{totalMinus}</b>
          </div>
        </div>

        {options.length === 0 && (
          <div className="text-sm text-gray-600">No options found.</div>
        )}

        <div className="space-y-2">
          {options.map((opt) => {
            const already = votedIdx.has(opt.index);
            const canPlus =
              votingEnabled && remainingPlus > 0 && phase === "open" && !already;
            const canMinus =
              votingEnabled &&
              remainingMinus > 0 &&
              phase === "open" &&
              minusAllowedByRatio &&
              !already;

            return (
              <div key={opt.index} className="flex items-center justify-between border p-3 rounded">
                <div className="flex-1">
                  <div className="font-medium">
                    #{opt.index} {opt.label}
                  </div>
                  <div className="text-sm text-gray-700">
                    +{opt.plus} / −{opt.minus}{" "}
                    {already && phase !== "after" && (
                      <span className="ml-2 text-xs text-gray-500">(you already voted)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => castVote(opt, 1)}
                    disabled={!canPlus}
                    title={
                      already
                        ? "You already voted on this option"
                        : !votingEnabled
                        ? "Unavailable"
                        : "Cast +1"
                    }
                    className={`px-3 py-2 rounded text-white ${
                      canPlus ? "bg-emerald-600 hover:bg-emerald-700" : "bg-emerald-300 cursor-not-allowed"
                    }`}
                  >
                    +1
                  </button>
                  <button
                    onClick={() => castVote(opt, -1)}
                    disabled={!canMinus}
                    title={
                      already
                        ? "You already voted on this option"
                        : !minusAllowedByRatio
                        ? "Need two + votes per − vote"
                        : !votingEnabled
                        ? "Unavailable"
                        : "Cast −1"
                    }
                    className={`px-3 py-2 rounded text-white ${
                      canMinus ? "bg-rose-600 hover:bg-rose-700" : "bg-rose-300 cursor-not-allowed"
                    }`}
                  >
                    −1
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
