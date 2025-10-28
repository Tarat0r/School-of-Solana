//-------------------------------------------------------------------------------
///
/// TASK: Implement the deposit functionality for the on-chain vault
/// 
/// Requirements:
/// - Verify that the user has enough balance to deposit
/// - Verify that the vault is not locked
/// - Transfer lamports from user to vault using CPI (Cross-Program Invocation)
/// - Emit a deposit event after successful transfer
/// 
///-------------------------------------------------------------------------------
use anchor_lang:: prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::system_instruction::transfer;
use crate::state::Vault;
use crate::errors::VaultError;
use crate::events::DepositEvent;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn _deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {

    let vault = &mut ctx.accounts.vault;
    let user = &mut ctx.accounts.user; 
    
    require!(!vault.locked, VaultError::VaultLocked);
    require!(amount > 0, VaultError::InsufficientBalance);

    let from = user.to_account_info();
    require!(from.lamports() >= amount, VaultError::InsufficientBalance);

    let to = vault.to_account_info();
    let ix = transfer(&from.key(), &to.key(), amount);
    
    invoke(&ix, &[from.clone(), to.clone()])?;

    emit!(DepositEvent{
        amount,
        vault: vault.key(),
        user: user.key(),
    });

    Ok(())
}