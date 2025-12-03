import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";    // type-only
import { SystemProgram, PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { createHash } from "crypto";
import type { D21Voting } from "../target/types/d21_voting";

// ---- helpers ----
const MAX_LABEL = 64;

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
function msgOf(e: any): string {
  return (
    e?.error?.errorMessage ??
    (Array.isArray(e?.logs) ? e.logs.join("\n") : "") ??
    String(e)
  );
}
async function expectIxFail(p: Promise<any>, re: RegExp) {
  try {
    await p;
    expect.fail("expected failure");
  } catch (e) {
    expect(msgOf(e)).to.match(re);
  }
}
function labelSeed(label: string): Buffer {
  const canonical = label.trim().toLowerCase();
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest(); // 32 bytes
}

// ---- tests ----
describe("add_option", () => {
  const authority = Keypair.generate();
  const rando = Keypair.generate(); // for unauthorized test
  let pollPda: PublicKey;

  before(async () => {
    await airdrop(authority.publicKey);
    await airdrop(rando.publicKey);

    // create a poll that starts in ~10 minutes
    const cfg = {
      pollId: new BN(101),
      title: "AddOption demo",
      description: "demo",
      plusCredits: 2,
      minusCredits: 1,
      startTs: new BN(nowSec() + 600),
      endTs: new BN(nowSec() + 3600),
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
        // Anchor can derive poll, but we pass it explicitly for clarity:
        poll: pollPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  });

  it("adds option 0 successfully and bumps options_count", async () => {
    const index = 0;
    const label = "Option A";

    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(index)],
      program.programId
    )[0];

    const seed = labelSeed(label);
    const labelGuard = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda.toBuffer(), seed],
      program.programId
    )[0];

    // optional: listen for event
    const sub = await program.addEventListener("optionAdded", (ev) => {
      expect(ev.poll.toBase58()).to.eq(pollPda.toBase58());
      expect(Number(ev.index)).to.eq(index);
      expect(ev.label).to.eq(label);
    });

    await program.methods
      // add_option now expects (index, label, label_seed: [u8; 32])
      .addOption(index, label, [...seed])
      .accountsPartial({
        authority: authority.publicKey,
        poll: pollPda,
        optionNode: optionPda,
        labelGuard,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.removeEventListener(sub);

    // read back accounts
    const poll = await program.account.poll.fetch(pollPda);
    const option = await program.account.optionNode.fetch(optionPda);
    const lgAi = await provider.connection.getAccountInfo(labelGuard, "confirmed");

    expect(Number(poll.optionsCount)).to.eq(1);
    expect(option.poll.toBase58()).to.eq(pollPda.toBase58());
    expect(Number(option.index)).to.eq(index);
    expect(option.label).to.eq(label);
    expect(Number(option.plusVotes)).to.eq(0);
    expect(Number(option.minusVotes)).to.eq(0);
    expect(lgAi, "label guard PDA should exist").to.not.be.null;
  });

  it("rejects empty or whitespace-only label", async () => {
    const index = 1;
    const bad = "   ";

    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(index)],
      program.programId
    )[0];

    const seed = labelSeed(bad);
    const labelGuard = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda.toBuffer(), seed],
      program.programId
    )[0];

    await expectIxFail(
      program.methods
        .addOption(index, bad, [...seed])
        .accountsPartial({
          authority: authority.publicKey,
          poll: pollPda,
          optionNode: optionPda,
          labelGuard,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /Option label is empty/i
    );
  });

  it("rejects too-long label", async () => {
    const index = 2;
    const label = "x".repeat(MAX_LABEL + 1);

    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(index)],
      program.programId
    )[0];

    const seed = labelSeed(label);
    const labelGuard = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda.toBuffer(), seed],
      program.programId
    )[0];

    await expectIxFail(
      program.methods
        .addOption(index, label, [...seed])
        .accountsPartial({
          authority: authority.publicKey,
          poll: pollPda,
          optionNode: optionPda,
          labelGuard,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /Label too long/i
    );
  });

  it("rejects duplicate index for the same poll", async () => {
    const index = 3;
    const label = "Dup";

    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(index)],
      program.programId
    )[0];

    const seed = labelSeed(label);
    const labelGuard = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda.toBuffer(), seed],
      program.programId
    )[0];

    // first add
    await program.methods
      .addOption(index, label, [...seed])
      .accountsPartial({
        authority: authority.publicKey,
        poll: pollPda,
        optionNode: optionPda,
        labelGuard,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // second add should fail on account already exists (option_node or label_guard)
    await expectIxFail(
      program.methods
        .addOption(index, label, [...seed])
        .accountsPartial({
          authority: authority.publicKey,
          poll: pollPda,
          optionNode: optionPda,
          labelGuard,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /(already in use|AccountInUse|account exists)/i
    );
  });

  it("rejects unauthorized authority", async () => {
    const index = 4;
    const label = "Wrong auth";

    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda.toBuffer(), u16LeBytes(index)],
      program.programId
    )[0];

    const seed = labelSeed(label);
    const labelGuard = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda.toBuffer(), seed],
      program.programId
    )[0];

    await expectIxFail(
      program.methods
        .addOption(index, label, [...seed])
        .accountsPartial({
          authority: rando.publicKey,      // not the poll.authority
          poll: pollPda,
          optionNode: optionPda,
          labelGuard,
          systemProgram: SystemProgram.programId,
        })
        .signers([rando])
        .rpc(),
      /Unauthorized/i
    );
  });

  it("rejects after poll has started", async () => {
    // make a fresh poll that starts very soon, then wait
    const soonPollId = new BN(202);
    const cfg = {
      pollId: soonPollId,
      title: "Soon",
      description: "starts soon",
      plusCredits: 1,
      minusCredits: 0,
      startTs: new BN(nowSec() + 1),
      endTs: new BN(nowSec() + 120),
    };

    const soonPollPda = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority.publicKey,
        authority: authority.publicKey,
        poll: soonPollPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // wait until it has started
    await new Promise((r) => setTimeout(r, 2500));

    const idx = 0;
    const optionPda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), soonPollPda.toBuffer(), u16LeBytes(idx)],
      program.programId
    )[0];

    const seed = labelSeed("Late");
    const labelGuard = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), soonPollPda.toBuffer(), seed],
      program.programId
    )[0];

    await expectIxFail(
      program.methods
        .addOption(idx, "Late", [...seed])
        .accountsPartial({
          authority: authority.publicKey,
          poll: soonPollPda,
          optionNode: optionPda,
          labelGuard,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /Can\'t add an option, voting is already started/i
    );
  });

  // --- unique label tests (require label guard) ---
  it("creates a label guard for a unique label and accepts a second distinct label", async () => {
    const authority2 = Keypair.generate();
    await airdrop(authority2.publicKey);

    const cfg = {
      pollId: new BN(901),
      title: "Unique labels",
      description: "demo",
      plusCredits: 2,
      minusCredits: 0,
      startTs: new BN(nowSec() + 600),
      endTs: new BN(nowSec() + 3600),
    };

    const pollPda2 = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority2.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority2.publicKey,
        authority: authority2.publicKey,
        poll: pollPda2,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority2])
      .rpc();

    // First label
    const idx0 = 0;
    const labelA = "Alpha";
    const option0Pda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda2.toBuffer(), u16LeBytes(idx0)],
      program.programId
    )[0];
    const seedA = labelSeed(labelA);
    const labelGuardA = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda2.toBuffer(), seedA],
      program.programId
    )[0];

    await program.methods
      .addOption(idx0, labelA, [...seedA])
      .accountsPartial({
        authority: authority2.publicKey,
        poll: pollPda2,
        optionNode: option0Pda,
        labelGuard: labelGuardA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority2])
      .rpc();

    // label guard PDA must exist
    const aiA = await provider.connection.getAccountInfo(labelGuardA, "confirmed");
    expect(aiA, "label guard PDA should be created").to.not.be.null;

    // Second, different label should succeed
    const idx1 = 1;
    const labelB = "Beta";
    const option1Pda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda2.toBuffer(), u16LeBytes(idx1)],
      program.programId
    )[0];
    const seedB = labelSeed(labelB);
    const labelGuardB = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda2.toBuffer(), seedB],
      program.programId
    )[0];

    await program.methods
      .addOption(idx1, labelB, [...seedB])
      .accountsPartial({
        authority: authority2.publicKey,
        poll: pollPda2,
        optionNode: option1Pda,
        labelGuard: labelGuardB,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority2])
      .rpc();

    const aiB = await provider.connection.getAccountInfo(labelGuardB, "confirmed");
    expect(aiB, "second label guard PDA should be created").to.not.be.null;
  });

  it("rejects duplicate label in the same poll (case/space insensitive)", async () => {
    const authority3 = Keypair.generate();
    await airdrop(authority3.publicKey);

    const cfg = {
      pollId: new BN(902),
      title: "Duplicate label block",
      description: "demo",
      plusCredits: 2,
      minusCredits: 0,
      startTs: new BN(nowSec() + 600),
      endTs: new BN(nowSec() + 3600),
    };

    const pollPda3 = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority3.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority3.publicKey,
        authority: authority3.publicKey,
        poll: pollPda3,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority3])
      .rpc();

    // First: "Alpha"
    const idx0 = 0;
    const label1 = "Alpha";
    const option0Pda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda3.toBuffer(), u16LeBytes(idx0)],
      program.programId
    )[0];
    const seed1 = labelSeed(label1);
    const labelGuard1 = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda3.toBuffer(), seed1],
      program.programId
    )[0];

    await program.methods
      .addOption(idx0, label1, [...seed1])
      .accountsPartial({
        authority: authority3.publicKey,
        poll: pollPda3,
        optionNode: option0Pda,
        labelGuard: labelGuard1,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority3])
      .rpc();

    // Duplicate with different case/whitespace: "  aLpHa  "
    const idx1 = 1;
    const dup = "  aLpHa  ";
    const option1Pda = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollPda3.toBuffer(), u16LeBytes(idx1)],
      program.programId
    )[0];
    const seedDup = labelSeed(dup);
    const labelGuardDup = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollPda3.toBuffer(), seedDup],
      program.programId
    )[0];

    // canonical seeds must match
    expect(Buffer.compare(seed1, seedDup)).to.eq(0);

  await expectIxFail(
    program.methods
      .addOption(idx1, dup, [...seedDup])
      .accountsPartial({
        authority: authority.publicKey,
        poll: pollPda,
        optionNode: option1Pda,
        labelGuard: labelGuardDup,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc(),
    /(Option label already exists|LabelAlreadyUsed|already used|seeds constraint was violated)/i
  );

  });

  it("allows the same label in a different poll", async () => {
    const authority4 = Keypair.generate();
    await airdrop(authority4.publicKey);

    // Poll A
    const cfgA = {
      pollId: new BN(903),
      title: "Poll A",
      description: "demo",
      plusCredits: 1,
      minusCredits: 0,
      startTs: new BN(nowSec() + 600),
      endTs: new BN(nowSec() + 3600),
    };
    const pollA = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority4.publicKey.toBuffer(), u64LeBytes(cfgA.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfgA)
      .accountsPartial({
        payer: authority4.publicKey,
        authority: authority4.publicKey,
        poll: pollA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority4])
      .rpc();

    // Poll B (same authority, different poll id)
    const cfgB = { ...cfgA, pollId: new BN(904), title: "Poll B" };
    const pollB = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority4.publicKey.toBuffer(), u64LeBytes(cfgB.pollId)],
      program.programId
    )[0];

    await program.methods
      .initializePoll(cfgB)
      .accountsPartial({
        payer: authority4.publicKey,
        authority: authority4.publicKey,
        poll: pollB,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority4])
      .rpc();

    const label = "Same Name";
    const seed = labelSeed(label);

    // Add to Poll A
    const optA = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollA.toBuffer(), u16LeBytes(0)],
      program.programId
    )[0];
    const guardA = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollA.toBuffer(), seed],
      program.programId
    )[0];

    await program.methods
      .addOption(0, label, [...seed])
      .accountsPartial({
        authority: authority4.publicKey,
        poll: pollA,
        optionNode: optA,
        labelGuard: guardA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority4])
      .rpc();

    // Same label should be allowed in Poll B (different PDA namespace)
    const optB = PublicKey.findProgramAddressSync(
      [Buffer.from("option"), pollB.toBuffer(), u16LeBytes(0)],
      program.programId
    )[0];
    const guardB = PublicKey.findProgramAddressSync(
      [Buffer.from("option_label"), pollB.toBuffer(), seed],
      program.programId
    )[0];

    await program.methods
      .addOption(0, label, [...seed])
      .accountsPartial({
        authority: authority4.publicKey,
        poll: pollB,
        optionNode: optB,
        labelGuard: guardB,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority4])
      .rpc();
  });
});
