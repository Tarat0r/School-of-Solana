//-------------------------------------------------------------------------------
///
/// TASK: Implement the remove comment functionality for the Twitter program
/// 
/// Requirements:
/// - Close the comment account and return rent to comment author
/// 
/// NOTE: No implementation logic is needed in the function body - this 
/// functionality is achieved entirely through account constraints!
/// 
///-------------------------------------------------------------------------------
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

use crate::states::*;

pub fn remove_comment(_ctx: Context<RemoveCommentContext>) -> Result<()> {
    
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveCommentContext<'info> {
    /// Rent destination
    #[account(mut)]
    pub comment_author: Signer<'info>,

    /// Close the specific comment PDA:
    /// seeds = [COMMENT_SEED, comment_author, hash(content), parent_tweet]
    /// Validate PDA using the account data, then close to author.
    #[account(
        mut,
        constraint = Pubkey::find_program_address(
            &[
                COMMENT_SEED.as_bytes(),
                comment_author.key().as_ref(),
                hash(comment.content.as_bytes()).to_bytes().as_ref(),
                comment.parent_tweet.as_ref(),
            ],
            &crate::ID
        ) == (comment.key(), comment.bump),
        close = comment_author
    )]
    pub comment: Account<'info, Comment>,
}
