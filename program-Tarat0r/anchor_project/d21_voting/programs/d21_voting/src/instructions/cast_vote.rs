use anchor_lang::prelude::*;
use crate::errors::D21Error;
use crate::states::{OptionNode, Poll, Receipt, Voter};

pub fn handler(ctx: Context<CastVote>, _index: u16, sentiment: i8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let poll = &mut ctx.accounts.poll;
    
    require!(now >= poll.start_ts, D21Error::VotingNotStarted);
    require!(now <= poll.end_ts, D21Error::VotingClosed);
    require!(matches!(sentiment, 1 | -1), D21Error::InvalidSentiment);

    let option = &mut ctx.accounts.option_node;
    let voter = &mut ctx.accounts.voter;
    let receipt = &mut ctx.accounts.receipt;
    
    if voter.poll == Pubkey::default() {
        voter.poll = poll.key();
        voter.voter = ctx.accounts.voter_authority.key();
        voter.used_plus = 0;
        voter.used_minus = 0;
    } else {
        require_keys_eq!(voter.poll, poll.key(), D21Error::PollMismatch);
        require_keys_eq!(voter.voter, ctx.accounts.voter_authority.key(), D21Error::Unauthorized);
    }
    
    if receipt.poll != Pubkey::default() {
        // already created before
        require_keys_eq!(receipt.poll, poll.key(), D21Error::PollMismatch);
        require_keys_eq!(receipt.voter, ctx.accounts.voter_authority.key(), D21Error::Unauthorized);
        require!(receipt.option_index == option.index, D21Error::PollMismatch);
        return err!(D21Error::AlreadyVotedThisOption);
    }

    match sentiment {
        1 => {
            require!(voter.used_plus < poll.plus_credits, D21Error::OutOfPositiveCredits);
            voter.used_plus = voter.used_plus.checked_add(1).ok_or(D21Error::MathOverflow)?;
            option.plus_votes = option.plus_votes.checked_add(1).ok_or(D21Error::MathOverflow)?;
        }
        -1 => {
            // ratio gate: require P >= 2*(M+1) before casting this minus
            let p = voter.used_plus as u16;
            let m_next = (voter.used_minus as u16) + 1;
            require!(p >= 2 * m_next, D21Error::InsufficientPositivesForNegative);

            require!(voter.used_minus < poll.minus_credits, D21Error::OutOfNegativeCredits);
            voter.used_minus = voter.used_minus.checked_add(1).ok_or(D21Error::MathOverflow)?;
            option.minus_votes = option.minus_votes.checked_add(1).ok_or(D21Error::MathOverflow)?;
        }
        _ => unreachable!(),
    }

    // write receipt so this option cannot be voted again by this voter
    receipt.poll = poll.key();
    receipt.voter = ctx.accounts.voter_authority.key();
    receipt.option_index = option.index;
    receipt.sentiment = sentiment;
    
    emit!(crate::states::VoteCast {
        poll: poll.key(),
        voter: voter.voter,
        option_index: option.index,
        sentiment,
        used_plus: voter.used_plus,
        used_minus: voter.used_minus
    });
    Ok(())
}


#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CastVote<'info> {
   
    #[account(mut)]
    pub voter_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"poll", poll.authority.as_ref(), &poll.poll_id.to_le_bytes()],
        bump,
        constraint = !poll.ended @ D21Error::VotingClosed,
    )]
    pub poll: Account<'info, Poll>,

    #[account(
        mut,
        seeds = [b"option", poll.key().as_ref(), &index.to_le_bytes()],
        bump,
        constraint = option_node.poll == poll.key() @ D21Error::PollMismatch,
    )]
    pub option_node: Account<'info, OptionNode>,

    #[account(
        init_if_needed,
        payer = voter_authority,
        space = Voter::SPACE,
        seeds = [b"voter", poll.key().as_ref(), voter_authority.key().as_ref()],
        bump
    )]
    pub voter: Account<'info, Voter>,

    #[account(
        init_if_needed,
        payer = voter_authority,
        space = Receipt::SPACE,
        seeds = [b"receipt", poll.key().as_ref(), &index.to_le_bytes(), voter_authority.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,

    pub system_program: Program<'info, System>,
}