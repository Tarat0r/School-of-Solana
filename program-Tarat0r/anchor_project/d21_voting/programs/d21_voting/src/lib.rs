use anchor_lang::prelude::*;

pub mod errors;
pub mod states;
pub mod instructions;

use instructions::*;

declare_id!("5K9LFpBoVfzaw6hjfL4XnuwC88p5xt3UJYX5LTfRrvkE");

#[program]
pub mod d21_voting {
    use super::*;

    pub fn initialize_poll(
        ctx: Context<InitializePoll>,
        cfg: PollConfig
    ) -> Result<()> {
        initialize_poll::handler(
            ctx,
            cfg
        )
    }


    pub fn add_option(ctx: Context<AddOption>, index: u16, label: String, label_seed: [u8; 32]) -> Result<()> {
        add_option::handler(ctx, index, label, label_seed)
    }

    pub fn cast_vote(ctx: Context<CastVote>, index: u16, sentiment: i8) -> Result<()> {
        cast_vote::handler(ctx, index, sentiment)
    }
}


