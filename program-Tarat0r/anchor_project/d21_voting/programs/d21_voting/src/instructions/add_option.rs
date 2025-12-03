use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash;
use crate::errors::D21Error;
use crate::states::{LabelGuard, MAX_LABEL, OptionNode, Poll};

pub fn handler(ctx: Context<AddOption>, index: u16, label: String, label_seed: [u8; 32]) -> Result<()> {
    
    let poll = &mut ctx.accounts.poll;
    
    // no edits after start
    require!(poll.start_ts > Clock::get()?.unix_timestamp, D21Error::VotingStarted);
    
    let trimmed = label.trim();
    require!(!trimmed.is_empty(), D21Error::LabelEmpty);
    require!(trimmed.len() <= MAX_LABEL, D21Error::LabelTooLong);

    // Canonicalize and verify the seed matches canonical label
    let canonical = trimmed.to_lowercase();
    let expected = hash::hash(canonical.as_bytes()).to_bytes();
    require!(label_seed == expected, D21Error::LabelSeedMismatch);

    // Uniqueness: guard must be unused before
    let guard = &mut ctx.accounts.label_guard;
    if guard.poll != Pubkey::default() {
        // Already initialized => label already used in this poll
        return err!(D21Error::LabelAlreadyUsed);
    }
    guard.poll = poll.key();
    guard.label_hash = label_seed;

    let option = &mut ctx.accounts.option_node;
    option.poll = poll.key();
    option.index = index;
    option.label = trimmed.to_string();
    option.plus_votes = 0;
    option.minus_votes = 0;
    poll.options_count = poll.options_count.max(index.saturating_add(1));

    emit!(OptionAdded { poll: poll.key(), index, label });
    Ok(())
}

#[event]
pub struct OptionAdded {
    pub poll: Pubkey,
    pub index: u16,
    pub label: String,
}

#[derive(Accounts)]
#[instruction(index: u16, label: String, label_seed: [u8; 32])]
pub struct AddOption<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"poll", poll.authority.as_ref(), &poll.poll_id.to_le_bytes()],
        bump,
        constraint = poll.authority == authority.key() @ D21Error::Unauthorized,
        constraint = !poll.ended @ D21Error::VotingClosed
    )]
    pub poll: Account<'info, Poll>,

    #[account(
        init_if_needed,
        payer = authority,
        space = LabelGuard::SPACE,
        seeds = [b"option_label", poll.key().as_ref(), &label_seed],
        bump
    )]
    pub label_guard: Account<'info, LabelGuard>,

    #[account(
        init,
        payer = authority,
        space = OptionNode::SPACE,
        seeds = [b"option", poll.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub option_node: Account<'info, OptionNode>,

    pub system_program: Program<'info, System>,
}

