use anchor_lang::prelude::*;
use crate::errors::D21Error;
use crate::states::{Poll, MAX_DESC, MAX_TITLE};


pub fn handler(ctx: Context<InitializePoll>, cfg: PollConfig) -> Result<()> {
    
    require!(cfg.poll_id != 0, D21Error::InvalidPollId);
    require!(cfg.title.len() <= MAX_TITLE, D21Error::TitleTooLong);
    require!(cfg.description.len() <= MAX_DESC, D21Error::DescriptionTooLong);
    require!(cfg.plus_credits > 0, D21Error::PlusCreditIsZero);
    require!(cfg.end_ts > cfg.start_ts, D21Error::InvalidTimeWindow);
    require!(cfg.start_ts >= Clock::get()?.unix_timestamp, D21Error::InvalidTimeWindow);
    
    let authority = ctx.accounts.authority.key();
    ctx.accounts.poll.set_inner(Poll::from_config(cfg, authority));
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(cfg: PollConfig)]
pub struct InitializePoll<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Poll::SPACE,
        seeds = [b"poll", authority.key().as_ref(), &cfg.poll_id.to_le_bytes()],
        bump
    )]
    pub poll: Account<'info, Poll>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PollConfig {
   pub  poll_id: u64,
   pub  title: String,
   pub  description: String,
   pub  plus_credits: u8,
   pub  minus_credits: u8,
   pub  start_ts: i64,
   pub  end_ts: i64,
}

impl Poll {
    pub fn from_config(cfg: PollConfig, authority: Pubkey) -> Self {
        Self {
            authority,
            poll_id: cfg.poll_id,
            title: cfg.title,
            description: cfg.description,
            plus_credits: cfg.plus_credits,
            minus_credits: cfg.minus_credits,
            start_ts: cfg.start_ts,
            end_ts: cfg.end_ts,
            options_count: 0,
            ended: false,
        }
    }
}

