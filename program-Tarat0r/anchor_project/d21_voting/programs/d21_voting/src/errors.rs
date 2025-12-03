use anchor_lang::prelude::*;

#[error_code]
pub enum D21Error {
    #[msg("Voting has not started")]
    VotingNotStarted,
    #[msg("Voting is closed")]
    VotingClosed,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Title too long")]
    TitleTooLong,
    #[msg("Description too long")]
    DescriptionTooLong,
    #[msg("Label too long")]
    LabelTooLong,
    #[msg("Invalid sentiment")]
    InvalidSentiment,
    #[msg("Out of positive credits")]
    OutOfPositiveCredits,
    #[msg("Out of negative credits")]
    OutOfNegativeCredits,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Already voted on this option")]
    AlreadyVotedThisOption,
    #[msg("Not enough positive votes to cast a negative vote (need P ≥ 2·(M+1))")]
    InsufficientPositivesForNegative,

    #[msg("Invalid Poll ID")]
    InvalidPollId,
    #[msg("Poll ID is mismatched")]
    PollIdMismatch,
    #[msg("Plus Credit is zero")]
    PlusCreditIsZero,
    #[msg("Minus Credit is zero")]
    MinusCreditIsZero,
    #[msg("Invalid voting time window")]
    InvalidTimeWindow,

    #[msg("Can't add an option, voting is already started")]
    VotingStarted,
    #[msg("Option label is empty")]
    LabelEmpty,
    #[msg("Option label already exists for this poll")]
    LabelAlreadyUsed,
    #[msg("Label seed/hash mismatch")]
    LabelSeedMismatch,

    #[msg("Option dont't belong to this poll")]
    PollMismatch
}
