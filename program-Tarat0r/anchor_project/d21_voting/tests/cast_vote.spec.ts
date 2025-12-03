import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";       // type-only
import { SystemProgram, PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { createHash } from "crypto";
import type { D21Voting } from "../target/types/d21_voting";

// ---------- setup helpers ----------
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.D21Voting as Program<D21Voting>;

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
  return e?.error?.errorCode?.code; // e.g. "AlreadyVotedThisOption"
}
async function expectAnchorErrCode(p: Promise<any>, code: string) {
  try { await p; expect.fail("expected failure"); }
  catch (e) { const got = anchorErrCode(e); if (!got) throw e; expect(got).to.equal(code); }
}

// label uniqueness helpers
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

// receipt PDA (one per voter per option)
function receiptPda(poll: PublicKey, index: number, voter: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), poll.toBuffer(), u16LeBytes(index), voter.toBuffer()],
    program.programId
  )[0];
}

// ---------- tests ----------
describe("cast_vote", () => {
  const authority = Keypair.generate();
  let pollPda: PublicKey;
  let option0Pda: PublicKey;
  let option1Pda: PublicKey;
  const voter = Keypair.generate(); // use explicit voter/caller

  before(async () => {
    await airdrop(authority.publicKey);
    await airdrop(voter.publicKey);

    // Create a poll that opens soon and runs for a while
    const start = nowSec() + 2;
    const cfg = {
      pollId: new BN(301),
      title: "CastVote demo",
      description: "demo",
      plusCredits: 1,      // single +1 allowed in this poll
      minusCredits: 1,     // single -1 allowed in this poll (subject to ratio rules)
      startTs: new BN(start),
      endTs: new BN(start + 3600),
    };

    pollPda = PublicKey.findProgramAddressSync(
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

    // Add two options (0 and 1) before start — with label guards
    option0Pda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(0)],
      program.programId
    )[0];
    {
      const label = "Alpha";
      const seed = labelSeed(label);
      const guard = labelGuardPda(pollPda, seed);
      await program.methods
        .addOption(0, label, [...seed])
        .accountsPartial({
          authority: authority.publicKey,
          poll: pollPda,
          optionNode: option0Pda,
          labelGuard: guard,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }

    option1Pda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(1)],
      program.programId
    )[0];
    {
      const label = "Beta";
      const seed = labelSeed(label);
      const guard = labelGuardPda(pollPda, seed);
      await program.methods
        .addOption(1, label, [...seed])
        .accountsPartial({
          authority: authority.publicKey,
          poll: pollPda,
          optionNode: option1Pda,
          labelGuard: guard,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    }

    // wait until poll is open
    await waitUntilChainTime(start);
  });

  it("casts +1, initializes voter, updates counters, emits event", async () => {
    const index = 0;

    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), pollPda.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    )[0];
    const rcpt = receiptPda(pollPda, index, voter.publicKey);

    // event listener (optional)
    const sub = await program.addEventListener("voteCast", (ev) => {
      expect(ev.poll.toBase58()).to.eq(pollPda.toBase58());
      expect(Number(ev.optionIndex)).to.eq(index);
      expect(Number(ev.sentiment)).to.eq(1);
      expect(Number(ev.usedPlus)).to.eq(1);
    });

    await program.methods
      .castVote(index, 1)
      .accountsPartial({
        voterAuthority: voter.publicKey,
        poll: pollPda,
        optionNode: option0Pda,
        voter: voterPda,
        receipt: rcpt,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter])
      .rpc();

    await program.removeEventListener(sub);

    // read back voter + option
    const voterAcct = await program.account.voter.fetch(voterPda);
    const opt = await program.account.optionNode.fetch(option0Pda);

    expect(voterAcct.poll.toBase58()).to.eq(pollPda.toBase58());
    expect(voterAcct.voter.toBase58()).to.eq(voter.publicKey.toBase58());
    expect(Number(voterAcct.usedPlus)).to.eq(1);
    expect(Number(opt.plusVotes)).to.eq(1);
  });

  it("blocks second +1 on the same option (one vote per option)", async () => {
    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), pollPda.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    )[0];
    const rcpt = receiptPda(pollPda, 0, voter.publicKey);

    await expectAnchorErrCode(
      program.methods
        .castVote(0, 1)
        .accountsPartial({
          voterAuthority: voter.publicKey,
          poll: pollPda,
          optionNode: option0Pda,
          voter: voterPda,
          receipt: rcpt,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter])
        .rpc(),
      "AlreadyVotedThisOption"
    );
  });

  it("blocks +1 on a different option when out of positive credits", async () => {
    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), pollPda.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    )[0];
    const rcpt = receiptPda(pollPda, 1, voter.publicKey);

    await expectAnchorErrCode(
      program.methods
        .castVote(1, 1) // different option, but we only had 1 + credit
        .accountsPartial({
          voterAuthority: voter.publicKey,
          poll: pollPda,
          optionNode: option1Pda,
          voter: voterPda,
          receipt: rcpt,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter])
        .rpc(),
      "OutOfPositiveCredits"
    );
  });

  it("allows −1 only after two +1 on other options (ratio + one-per-option)", async () => {
    const authority2 = Keypair.generate();
    const voter2 = Keypair.generate();
    await airdrop(authority2.publicKey);
    await airdrop(voter2.publicKey);

    const start = nowSec() + 2;
    const cfg = {
      pollId: new BN(302),
      title: "Negatives require positives",
      description: "ratio rule",
      plusCredits: 3,
      minusCredits: 1,
      startTs: new BN(start),
      endTs: new BN(start + 300),
    };

    const poll = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority2.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority2.publicKey,
        authority: authority2.publicKey,
        poll,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority2])
      .rpc();

    const opt0 = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), poll.toBuffer(), u16LeBytes(0)],
      program.programId
    )[0];
    const opt1 = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), poll.toBuffer(), u16LeBytes(1)],
      program.programId
    )[0];
    const opt2 = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), poll.toBuffer(), u16LeBytes(2)],
      program.programId
    )[0];

    {
      const seed = labelSeed("A");
      await program.methods.addOption(0, "A", [...seed]).accountsPartial({
        authority: authority2.publicKey,
        poll,
        optionNode: opt0,
        labelGuard: labelGuardPda(poll, seed),
        systemProgram: SystemProgram.programId,
      }).signers([authority2]).rpc();
    }
    {
      const seed = labelSeed("B");
      await program.methods.addOption(1, "B", [...seed]).accountsPartial({
        authority: authority2.publicKey,
        poll,
        optionNode: opt1,
        labelGuard: labelGuardPda(poll, seed),
        systemProgram: SystemProgram.programId,
      }).signers([authority2]).rpc();
    }
    {
      const seed = labelSeed("C");
      await program.methods.addOption(2, "C", [...seed]).accountsPartial({
        authority: authority2.publicKey,
        poll,
        optionNode: opt2,
        labelGuard: labelGuardPda(poll, seed),
        systemProgram: SystemProgram.programId,
      }).signers([authority2]).rpc();
    }

    await waitUntilChainTime(start);

    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), poll.toBuffer(), voter2.publicKey.toBuffer()],
      program.programId
    )[0];

    // +1 on two distinct options
    await program.methods.castVote(0, 1).accountsPartial({
      voterAuthority: voter2.publicKey,
      poll,
      optionNode: opt0,
      voter: voterPda,
      receipt: receiptPda(poll, 0, voter2.publicKey),
      systemProgram: SystemProgram.programId,
    }).signers([voter2]).rpc();

    await program.methods.castVote(1, 1).accountsPartial({
      voterAuthority: voter2.publicKey,
      poll,
      optionNode: opt1,
      voter: voterPda,
      receipt: receiptPda(poll, 1, voter2.publicKey),
      systemProgram: SystemProgram.programId,
    }).signers([voter2]).rpc();

    // Now −1 should pass
    await program.methods.castVote(2, -1).accountsPartial({
      voterAuthority: voter2.publicKey,
      poll,
      optionNode: opt2,
      voter: voterPda,
      receipt: receiptPda(poll, 2, voter2.publicKey),
      systemProgram: SystemProgram.programId,
    }).signers([voter2]).rpc();
  });

  it("blocks −1 when ratio is not satisfied", async () => {
    const auth = Keypair.generate();
    await airdrop(auth.publicKey);

    const start = nowSec() + 1;
    const cfg = {
      pollId: new BN(303),
      title: "ratio block",
      description: "need positives first",
      plusCredits: 1,
      minusCredits: 1,
      startTs: new BN(start),
      endTs: new BN(start + 120),
    };
    const poll = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), auth.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods.initializePoll(cfg).accountsPartial({
      payer: auth.publicKey, authority: auth.publicKey, poll, systemProgram: SystemProgram.programId,
    }).signers([auth]).rpc();

    const opt0 = PublicKey.findProgramAddressSync([Buffer.from("option"), poll.toBuffer(), u16LeBytes(0)], program.programId)[0];
    {
      const seed = labelSeed("Only");
      await program.methods.addOption(0, "Only", [...seed]).accountsPartial({
        authority: auth.publicKey, poll, optionNode: opt0, labelGuard: labelGuardPda(poll, seed), systemProgram: SystemProgram.programId,
      }).signers([auth]).rpc();
    }

    await waitUntilChainTime(start);

    const voterPda = PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), poll.toBuffer(), voter.publicKey.toBuffer()],
      program.programId
    )[0];

    await expectAnchorErrCode(
      program.methods.castVote(0, -1).accountsPartial({
        voterAuthority: voter.publicKey, poll, optionNode: opt0, voter: voterPda, receipt: receiptPda(poll, 0, voter.publicKey), systemProgram: SystemProgram.programId,
      }).signers([voter]).rpc(),
      "InsufficientPositivesForNegative"
    );
  });
});

