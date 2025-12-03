import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { SystemProgram, PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { createHash } from "crypto";
import type { D21Voting } from "../target/types/d21_voting";

// ---------- setup ----------
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.D21Voting as Program<D21Voting>;

const MAX_TITLE = 64;
const MAX_DESC = 256;

function u64LeBytes(n: BN): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n.toString()));
  return b;
}
function u16LeBytes(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
async function airdrop(pk: PublicKey, lamports = 2e9) {
  const sig = await provider.connection.requestAirdrop(pk, lamports);
  await provider.connection.confirmTransaction(sig, "confirmed");
}
function nowSec() {
  return Math.floor(Date.now() / 1000);
}
async function waitUntilChainTime(targetTs: number, timeoutMs = 15000, pollMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const slot = await provider.connection.getSlot("processed");
    const bt = await provider.connection.getBlockTime(slot); // seconds | null
    if (bt !== null && bt >= targetTs) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`timeout waiting for chain time >= ${targetTs}`);
}
function anchorErrCode(e: any): string | undefined {
  return e?.error?.errorCode?.code;
}
async function expectAnchorErrCode(p: Promise<any>, code: string) {
  try { await p; expect.fail("expected failure"); }
  catch (e) { const got = anchorErrCode(e); if (!got) throw e; expect(got).to.equal(code); }
}
function msgOf(e: any): string {
  return (
    e?.error?.errorMessage ??
    (Array.isArray(e?.logs) ? e.logs.join("\n") : "") ??
    String(e)
  );
}
async function expectIxFail(p: Promise<any>, re: RegExp) {
  try { await p; expect.fail("expected failure"); }
  catch (e) { expect(msgOf(e)).to.match(re); }
}

// --- label-guard helpers (must match program) ---
function labelSeed(label: string): Buffer {
  const canonical = label.trim().toLowerCase();
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest(); // 32 bytes
}
function labelGuardPda(poll: PublicKey, seed: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("option_label"), poll.toBuffer(), seed],
    program.programId
  )[0];
}

// ---------- tests ----------
describe("edge_cases", () => {
  it("accepts boundary lengths for title=64 and desc=256", async () => {
    const authority = Keypair.generate();
    await airdrop(authority.publicKey);

    const title = "t".repeat(MAX_TITLE);
    const description = "d".repeat(MAX_DESC);
    const start = nowSec() + 60;

    const cfg = {
      pollId: new BN(1001),
      title,
      description,
      plusCredits: 1,
      minusCredits: 0,
      startTs: new BN(start),
      endTs: new BN(start + 3600),
    };

    const pollPda = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority.publicKey,
        authority: authority.publicKey,
        poll: pollPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const acct = await program.account.poll.fetch(pollPda);
    const get = (o: any, k: string) => o[k] ?? o[k.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)];
    expect(get(acct, "title")).to.eq(title);
    expect(get(acct, "description")).to.eq(description);
  });

  it("bumps options_count correctly when adding a sparse index (index=5 -> count=6)", async () => {
    const authority = Keypair.generate();
    await airdrop(authority.publicKey);

    const start = nowSec() + 600; // future => can add_option
    const cfg = {
      pollId: new BN(1002),
      title: "Sparse index",
      description: "demo",
      plusCredits: 2,
      minusCredits: 1,
      startTs: new BN(start),
      endTs: new BN(start + 3600),
    };

    const pollPda = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority.publicKey,
        authority: authority.publicKey,
        poll: pollPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const index = 5; // intentionally skipping 0..4
    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(index)],
      program.programId
    )[0];

    const label = "Zeta";
    const seed = labelSeed(label);
    const guard = labelGuardPda(pollPda, seed);

    await program.methods
      .addOption(index, label, [...seed])
      .accountsPartial({
        authority: authority.publicKey,
        poll: pollPda,
        optionNode: optionPda,
        labelGuard: guard,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const poll = await program.account.poll.fetch(pollPda);
    expect(Number(poll.optionsCount)).to.eq(6); // max(index+1)
  });

  it("rejects −1 when ratio is not satisfied (even if minusCredits = 0)", async () => {
    const authority = Keypair.generate();
    const voter = Keypair.generate();
    await airdrop(authority.publicKey);
    await airdrop(voter.publicKey);

    const start = nowSec() + 1;
    const cfg = {
      pollId: new BN(1005),
      title: "No minus",
      description: "minus=0",
      plusCredits: 2,
      minusCredits: 0,
      startTs: new BN(start),
      endTs: new BN(start + 120),
    };

    const pollPda = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods.initializePoll(cfg).accountsPartial({
      payer: authority.publicKey, authority: authority.publicKey, poll: pollPda, systemProgram: SystemProgram.programId,
    }).signers([authority]).rpc();

    const opt = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(0)], program.programId
    )[0];

    const label = "Only plus";
    const seed = labelSeed(label);
    const guard = labelGuardPda(pollPda, seed);

    await program.methods.addOption(0, label, [...seed]).accountsPartial({
      authority: authority.publicKey, poll: pollPda, optionNode: opt, labelGuard: guard, systemProgram: SystemProgram.programId,
    }).signers([authority]).rpc();

    await waitUntilChainTime(start);

    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), pollPda.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    )[0];

    await expectAnchorErrCode(
      program.methods.castVote(0, -1).accountsPartial({
        voterAuthority: voter.publicKey, poll: pollPda, optionNode: opt, voter: voterPda,
        // receipt PDA is required by your program; derive if needed
        receipt: PublicKey.findProgramAddressSync(
          [Buffer.from("receipt"), pollPda.toBuffer(), u16LeBytes(0), voter.publicKey.toBuffer()],
          program.programId
        )[0],
        systemProgram: SystemProgram.programId,
      }).signers([voter]).rpc(),
      "InsufficientPositivesForNegative"
    );
  });

  it("fails when casting a vote for a non-existent option account", async () => {
    const authority = Keypair.generate();
    const voter = Keypair.generate();
    await airdrop(authority.publicKey);
    await airdrop(voter.publicKey);

    const start = nowSec() + 1;
    const cfg = {
      pollId: new BN(1006),
      title: "Missing option",
      description: "test",
      plusCredits: 1,
      minusCredits: 1,
      startTs: new BN(start),
      endTs: new BN(start + 120),
    };

    const pollPda = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods.initializePoll(cfg).accountsPartial({
      payer: authority.publicKey, authority: authority.publicKey, poll: pollPda, systemProgram: SystemProgram.programId,
    }).signers([authority]).rpc();

    await waitUntilChainTime(start);

    // Build PDA for an option that was never initialized
    const missingIndex = 7;
    const optionMissing = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(missingIndex)],
      program.programId
    )[0];

    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), pollPda.toBuffer(), voter.publicKey.toBuffer()], program.programId
    )[0];

    await expectIxFail(
      program.methods.castVote(missingIndex, 1).accountsPartial({
        voterAuthority: voter.publicKey,
        poll: pollPda,
        optionNode: optionMissing, // not initialized
        voter: voterPda,
        // still pass a receipt PDA; the failure will be on missing option account
        receipt: PublicKey.findProgramAddressSync(
          [Buffer.from("receipt"), pollPda.toBuffer(), u16LeBytes(missingIndex), voter.publicKey.toBuffer()],
          program.programId
        )[0],
        systemProgram: SystemProgram.programId,
      }).signers([voter]).rpc(),
      /(Account .* does not exist|has no data|could not find|AccountNotInitialized|expected .* to be initialized|The program expected this account to be already initialized)/i
    );
  });
});
