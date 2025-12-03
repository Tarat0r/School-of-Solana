import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor"; // type-only
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import type { D21Voting } from "../target/types/d21_voting";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.D21Voting as Program<D21Voting>;

const MAX_TITLE = 64;
const MAX_DESC = 256;

function u64LeBytes(n: BN): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n.toString()));
  return buf;
}

async function airdrop(conn: any, dest: PublicKey, lamports = 2e9) {
  const sig = await conn.requestAirdrop(dest, lamports);
  await conn.confirmTransaction(sig, "confirmed");
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

describe("initialize_poll", () => {
  const authority = Keypair.generate();
  let pollPda: PublicKey;

  before(async () => {
    await airdrop(provider.connection, authority.publicKey);
  });

  it("initializes a poll", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cfg = {
      pollId: new BN(1),
      title: "Roadmap Q1",
      description: "Pick priorities",
      plusCredits: 2,
      minusCredits: 0,
      startTs: new BN(now + 60),
      endTs: new BN(now + 7 * 24 * 3600),
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

    const acct = await program.account.poll.fetch(pollPda);
    const get = (o: any, k: string) => o[k] ?? o[k.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)];

    expect(get(acct, "authority").toBase58()).to.eq(authority.publicKey.toBase58());
    expect(get(acct, "pollId").toString()).to.eq(cfg.pollId.toString());
    expect(get(acct, "title")).to.eq(cfg.title);
    expect(get(acct, "description")).to.eq(cfg.description);
    expect(Number(get(acct, "plusCredits"))).to.eq(cfg.plusCredits);
    expect(Number(get(acct, "minusCredits"))).to.eq(cfg.minusCredits);
    expect(get(acct, "startTs").toString()).to.eq(cfg.startTs.toString());
    expect(get(acct, "endTs").toString()).to.eq(cfg.endTs.toString());
    expect(Number(get(acct, "optionsCount"))).to.eq(0);
    expect(get(acct, "ended")).to.eq(false);
  });

  it("rejects too-long title", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cfg = {
      pollId: new BN(2),
      title: "x".repeat(MAX_TITLE + 1),
      description: "ok",
      plusCredits: 1,
      minusCredits: 0,
      startTs: new BN(now + 60),
      endTs: new BN(now + 600),
    };

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    );

    await expectIxFail(
      program.methods
        .initializePoll(cfg)
        .accountsPartial({
          payer: authority.publicKey,
          authority: authority.publicKey,
          poll: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /Title too long/i
    );
  });

  it("rejects too-long description", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cfg = {
      pollId: new BN(3),
      title: "ok",
      description: "y".repeat(MAX_DESC + 1),
      plusCredits: 1,
      minusCredits: 0,
      startTs: new BN(now + 60),
      endTs: new BN(now + 600),
    };

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    );

    await expectIxFail(
      program.methods
        .initializePoll(cfg)
        .accountsPartial({
          payer: authority.publicKey,
          authority: authority.publicKey,
          poll: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /Description too long/i
    );
  });

  it("rejects plus_credits == 0", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cfg = {
      pollId: new BN(4),
      title: "ok",
      description: "ok",
      plusCredits: 0,
      minusCredits: 1,
      startTs: new BN(now + 60),
      endTs: new BN(now + 600),
    };

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    );

    await expectIxFail(
      program.methods
        .initializePoll(cfg)
        .accountsPartial({
          payer: authority.publicKey,
          authority: authority.publicKey,
          poll: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /Plus credit is zero/i
    );
  });

  it("rejects invalid time window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bads = [
      {
        pollId: new BN(5),
        title: "ok",
        description: "ok",
        plusCredits: 1,
        minusCredits: 0,
        startTs: new BN(now + 500),
        endTs: new BN(now + 400), // end <= start
      },
      {
        pollId: new BN(6),
        title: "ok",
        description: "ok",
        plusCredits: 1,
        minusCredits: 0,
        startTs: new BN(now - 10), // start in past
        endTs: new BN(now + 400),
      },
    ];

    for (const cfg of bads) {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
        program.programId
      );

      await expectIxFail(
        program.methods
          .initializePoll(cfg)
          .accountsPartial({
            payer: authority.publicKey,
            authority: authority.publicKey,
            poll: pda,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc(),
        /Invalid voting time window/i
      );
    }
  });

  it("fails on duplicate id for same authority (account already in use)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cfg = {
      pollId: new BN(10),
      title: "first",
      description: "first",
      plusCredits: 1,
      minusCredits: 0,
      startTs: new BN(now + 60),
      endTs: new BN(now + 600),
    };

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("poll"), authority.publicKey.toBuffer(), u64LeBytes(cfg.pollId)],
      program.programId
    );

    await program.methods
      .initializePoll(cfg)
      .accountsPartial({
        payer: authority.publicKey,
        authority: authority.publicKey,
        poll: pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await expectIxFail(
      program.methods
        .initializePoll(cfg)
        .accountsPartial({
          payer: authority.publicKey,
          authority: authority.publicKey,
          poll: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc(),
      /(already in use|AccountInUse|account exists)/i
    );
  });
});
