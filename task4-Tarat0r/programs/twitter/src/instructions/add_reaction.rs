//-------------------------------------------------------------------------------
///
/// TASK: Implement the add reaction functionality for the Twitter program
/// 
/// Requirements:
/// - Initialize a new reaction account with proper PDA seeds
/// - Increment the appropriate counter (likes or dislikes) on the tweet
/// - Set reaction fields: type, author, parent tweet, and bump
/// - Handle both Like and Dislike reaction types
/// 
///-------------------------------------------------------------------------------
use anchor_lang::prelude::*;
use crate::states::*;

pub fn add_reaction(ctx: Context<AddReactionContext>, reaction: ReactionType) -> Result<()> {

    match reaction {
        ReactionType::Like => {
            ctx.accounts.tweet.likes += 1;
        }
        ReactionType::Dislike => {
            ctx.accounts.tweet.dislikes += 1;
        }
    }

    let r = &mut ctx.accounts.tweet_reaction;
    r.reaction_author = ctx.accounts.reaction_author.key();
    r.parent_tweet = ctx.accounts.tweet.key();
    r.reaction = reaction;
    r.bump = ctx.bumps.tweet_reaction;

    Ok(())
}

#[derive(Accounts)]
pub struct AddReactionContext<'info> {
    // TODO: Add required account constraints
    #[account(mut)]
    pub reaction_author: Signer<'info>,
    #[account(
        init,
        payer = reaction_author,
        space = 8+Reaction::INIT_SPACE,
        seeds = [
            b"TWEET_REACTION_SEED",
            reaction_author.key().as_ref(),
            tweet.key().as_ref(),
        ],
        bump
    )]
    pub tweet_reaction: Account<'info, Reaction>,
    #[account(mut)]
    pub tweet: Account<'info, Tweet>,
    pub system_program: Program<'info, System>,
}
