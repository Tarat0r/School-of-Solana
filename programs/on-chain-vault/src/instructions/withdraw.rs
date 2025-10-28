//-------------------------------------------------------------------------------
///
/// TASK: Implement the withdraw functionality for the on-chain vault
/// 
/// Requirements:
/// - Verify that the vault is not locked
/// - Verify that the vault has enough balance to withdraw
/// - Transfer lamports from vault to vault authority
/// - Emit a withdraw event after successful transfer
/// 
///-------------------------------------------------------------------------------
use anchor_lang::prelude::*;
// use anchor_lang::solana_program::program::{invoke_signed};
// use anchor_lang::solana_program::system_instruction::transfer;
use crate::state::Vault;
use crate::errors::VaultError;
use crate::events::WithdrawEvent;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault_authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault",  vault_authority.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn _withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let vault_info = vault.to_account_info();
    let authority_info = ctx.accounts.vault_authority.to_account_info();

    require!(!vault.locked, VaultError::VaultLocked);
    require!(vault_info.lamports() >= amount, VaultError::InsufficientBalance);

    let authority_key = ctx.accounts.vault_authority.key();

    **vault_info.try_borrow_mut_lamports()? -= amount;
    **authority_info.try_borrow_mut_lamports()? = authority_info
    .lamports()
    .checked_add(amount)
    .ok_or(VaultError::Overflow)?;

    emit!(WithdrawEvent {
        amount,
        vault_authority: authority_key,
        vault: vault.key(),
    });

    Ok(())
}
