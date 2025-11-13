# Project Description

**Deployed Frontend URL:**

<https://program-tarat0r.vercel.app/>

**Solana Program ID:** 5K9LFpBoVfzaw6hjfL4XnuwC88p5xt3UJYX5LTfRrvkE

## Project Overview

### Description

This is a decentralized voting dApp implementing the D21 (Janeček) voting method on Solana. A poll authority initializes a poll with a time window and per‑voter credit limits for positive and negative votes. Voters can cast at most one vote per option. Negative votes are gated by a ratio rule: a voter must accumulate at least two positive votes for every negative vote they cast (require used_plus ≥ 2 × (used_minus + 1)).

Core concepts:

- A Poll is initialized by an authority with title, description, credit limits, and start/end times.
- The authority can add labeled options before the poll starts. Labels are canonicalized and uniqueness is enforced within the poll.
- During the voting window, any wallet can cast +1 or −1 on options subject to credit limits and the ratio rule; one vote per option is enforced via receipts.
- The frontend provides a “create poll” screen and a shareable voting page at `/vote/[authority]/[pollId]` with live tallies and winner display by net score (plus − minus).

### Key Features

- Poll initialization with validation: title/description length checks, start < end, starts in the future, plus credits > 0.
- Option management (pre‑start only): unique, case/whitespace‑insensitive labels using a label‑guard PDA; emits OptionAdded event.
- Voting with constraints: time‑window checks, credit accounting per voter, ratio gate for negatives, one vote per option via receipt PDA; emits VoteCast event.
- Deterministic PDA model for all accounts (polls, options, label guards, voters, receipts).
- Frontend UX: create/reinit poll, add options, live option list, link to dedicated voting page with credit usage and winners view.

### How to Use the dApp

1. Connect Wallet
2. Initialize Poll
   - Enter Poll ID, Title, Description
   - Set Plus Credits (must be > 0) and Minus Credits
   - Pick start offset and duration, then Create / Re‑init
3. Add Options
   - Enter an option label and click Add; repeat for multiple options (allowed before poll starts)
4. Share Voting Link
   - From the home page, open “Open voting page” or visit `/vote/[authority]/[pollId]`
5. Vote
   - During the window, cast +1 or −1 (subject to credits and the ratio rule). You can vote at most once per option
6. View Results
   - The voting page shows live tallies, remaining credits, and winners by net score

## Program Architecture

Anchor program with three instructions and five PDA account types. All PDAs use fixed seeds plus specific identifiers to ensure deterministic addresses and isolation per poll.

### PDA Usage

**PDAs Used:**

- Poll: seeds `["poll", authority, poll_id_le]` — one poll per authority per poll ID
- OptionNode: seeds `["option", poll, index_le]` — a numbered option within a poll
- LabelGuard: seeds `["option_label", poll, sha256(canonical_label)]` — enforces unique, canonical label per poll
- Voter: seeds `["voter", poll, voter_authority]` — per‑poll voter credit bookkeeping
- Receipt: seeds `["receipt", poll, index_le, voter_authority]` — one receipt per voter per option (prevents multiple votes on same option)

### Program Instructions

**Instructions Implemented:**

- initialize_poll(cfg: PollConfig)
  - Validates inputs (non‑zero plus credits, time window, string lengths) and creates the Poll account
- add_option(index: u16, label: String, label_seed: [u8; 32])
  - Pre‑start only; canonicalizes label, checks `sha256(lowercase(trim(label)))` matches `label_seed`, asserts uniqueness via LabelGuard, creates OptionNode, bumps `options_count`, emits OptionAdded
- cast_vote(index: u16, sentiment: i8)
  - Enforces time window; on +1 increments voter.used_plus and option.plus_votes; on −1 enforces `used_plus ≥ 2 × (used_minus + 1)`, then increments voter.used_minus and option.minus_votes; writes a Receipt so the same voter cannot vote on the same option again; emits VoteCast

### Account Structure

```rust
// anchor_project/d21_voting/programs/d21_voting/src/states.rs
#[account]
pub struct Poll {
    pub authority: Pubkey,
    pub poll_id: u64,
    pub title: String,        // ≤ 64 chars
    pub description: String,  // ≤ 256 chars
    pub plus_credits: u8,     // > 0
    pub minus_credits: u8,
    pub start_ts: i64,
    pub end_ts: i64,
    pub options_count: u16,
    pub ended: bool,
}

#[account]
pub struct OptionNode {
    pub poll: Pubkey,
    pub index: u16,
    pub label: String,  // ≤ 64 chars
    pub plus_votes: u32,
    pub minus_votes: u32,
}

#[account]
pub struct LabelGuard {        // unique label within a poll
    pub poll: Pubkey,
    pub label_hash: [u8; 32],  // sha256(lowercase(trim(label)))
}

#[account]
pub struct Voter {             // per-poll usage counters per wallet
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub used_plus: u8,
    pub used_minus: u8,
}

#[account]
pub struct Receipt {           // one per voter per option
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub option_index: u16,
    pub sentiment: i8, // 1 or -1
}
```

## Testing

### Test Coverage

Comprehensive TypeScript tests cover initialization, option management, voting flows, and enforced error paths.

**Happy Path Tests:**

- InitializePoll: creates poll with correct fields and defaults
- AddOption: adds option 0, emits event, bumps `options_count`
- LabelGuard: allows distinct labels and same label across different polls
- CastVote: +1 creates voter, updates counters, emits event; ratio‑satisfied −1 succeeds

**Unhappy Path Tests:**

- InitializePoll: rejects too‑long title/description, zero plus credits, invalid time windows, duplicate PDA
- AddOption: rejects empty/whitespace label, too‑long label, duplicate index, unauthorized authority, adding after start, duplicate canonical label within a poll
- CastVote: blocks second vote on same option (receipt), blocks +1 when out of positive credits, blocks −1 when ratio not met

### Running Tests

```bash
cd anchor_project/d21_voting
yarn install
anchor test
```

### Additional Notes for Evaluators

- Negative votes are gated by the D21 ratio rule at the voter level: require `used_plus ≥ 2 × (used_minus + 1)`.
- Option labels are canonicalized (trim + lowercase) and hashed with SHA‑256; a LabelGuard PDA ensures per‑poll uniqueness regardless of case/whitespace.
- One receipt PDA per option per voter prevents repeat voting on a single option while still allowing voters to distribute their credits across multiple options.
- The frontend mirrors on‑chain validation (lengths, credit ratio hints) and derives the same PDAs to reduce UX errors.
