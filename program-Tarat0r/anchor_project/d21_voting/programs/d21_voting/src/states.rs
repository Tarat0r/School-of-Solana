use anchor_lang::prelude::*;

pub const MAX_TITLE: usize = 64;
pub const MAX_DESC: usize = 256;
pub const MAX_LABEL: usize = 64;


#[account]
pub struct Poll {
    pub authority: Pubkey,
    pub poll_id: u64,
    pub title: String,
    pub description: String,
    pub plus_credits: u8,
    pub minus_credits: u8,
    pub start_ts: i64,
    pub end_ts: i64,
    pub options_count: u16,
    pub ended: bool,
}
impl Poll {
    pub const SPACE: usize = 8 + 32 + 8 + (4 + MAX_TITLE) + (4 + MAX_DESC)
        + 1 + 1 + 8 + 8 + 2 + 1;
}

#[account]
pub struct OptionNode {
    pub poll: Pubkey,
    pub index: u16,
    pub label: String,
    pub plus_votes: u32,
    pub minus_votes: u32,
}
impl OptionNode {
    pub const SPACE: usize = 8 + 32 + 2 + (4 + MAX_LABEL) + 4 + 4;
}

#[account]
pub struct LabelGuard {
    pub poll: Pubkey,
    pub label_hash: [u8; 32],
}
impl LabelGuard {
    // 8 discriminator + 32 + 32
    pub const SPACE: usize = 8 + 32 + 32;
}

#[account]
pub struct Voter {
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub used_plus: u8,
    pub used_minus: u8,
}
impl Voter {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1;
}

#[account]
pub struct Receipt {
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub option_index: u16,
    pub sentiment: i8, // 1 or -1
}
impl Receipt {
    // 8 discriminator + 32 + 32 + 2 + 1
    pub const SPACE: usize = 8 + 32 + 32 + 2 + 1;
}

#[event]
pub struct VoteCast {
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub option_index: u16,
    pub sentiment: i8,
    pub used_plus: u8,
    pub used_minus: u8,
}
