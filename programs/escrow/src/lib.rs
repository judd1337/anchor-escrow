use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

use crate::instructions::*;

declare_id!("HUk6tTBZdeCVprusZhfzrUEVXo5nzGxVA22y5uVG2tJb");

#[program]
pub mod escrow {
    use super::*;

    pub fn make(
        ctx: Context<Make>, 
        seed: u64, 
        receive_amount: u64, 
        deposit_amount: u64
    ) -> Result<()> {
        ctx.accounts.init_escrow_state(seed, receive_amount, ctx.bumps)?;
        ctx.accounts.deposit(deposit_amount)?;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.withdraw()?;
        ctx.accounts.close()?;
        Ok(())
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.withdraw()?;
        ctx.accounts.close()?;
        Ok(())
    }

    // taker wants to swap their tokens
    // you do not need to store them in vault
    //pub fn take()
}

