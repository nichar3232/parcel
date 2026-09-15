#![allow(unexpected_cfgs)]
// The client requests this heap frame. Solana's default allocator still uses
// only 32 KiB even when the transaction grants more; use the bounded frame.
#[cfg(target_os = "solana")]
#[global_allocator]
#[allow(deprecated)]
static ALLOCATOR: solana_program_entrypoint::BumpAllocator =
    solana_program_entrypoint::BumpAllocator {
        start: solana_program_entrypoint::HEAP_START_ADDRESS as usize,
        len: 256 * 1024,
    };
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
pub mod economics;
mod market;
use economics::{Action, Book};
declare_id!("CJxu36zhuU2Hx1BFisJdSQwdXoUkakA2UJ2WPxeT97af");
// Dedicated no-value local-validator operator. This is not a permissionless oracle.
const OPERATOR: Pubkey = pubkey!("8oheEujy8FS7Nr3bdYT7okWbWeMy3Tp5eM8z4YwRTzfq");
#[program]
pub mod oddlot {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        require!(
            ctx.accounts.cash_mint.key() != ctx.accounts.stock_mint.key(),
            VaultError::Mint
        );
        require!(
            ctx.accounts.cash_mint.decimals == 6 && ctx.accounts.stock_mint.decimals == 6,
            VaultError::Mint
        );
        require!(
            ctx.accounts.cash_mint.mint_authority == Some(OPERATOR).into()
                && ctx.accounts.stock_mint.mint_authority == Some(OPERATOR).into(),
            VaultError::Mint
        );
        let s = &mut ctx.accounts.ledger;
        s.owner = ctx.accounts.owner.key();
        s.operator = ctx.accounts.operator.key();
        s.cash_mint = ctx.accounts.cash_mint.key();
        s.stock_mint = ctx.accounts.stock_mint.key();
        s.revision = 0;
        s.book = Book::initial();
        require!(
            ctx.accounts.pool_cash.amount >= 4_000_000_000_000
                && ctx.accounts.pool_stock.amount >= 20_000_000_000,
            VaultError::Backing
        );
        require!(
            ctx.accounts.wallet_cash.amount == 10_000_000_000
                && ctx.accounts.wallet_stock.amount == 25_000_000,
            VaultError::Backing
        );
        Ok(())
    }
    pub fn execute(
        ctx: Context<Execute>,
        expected_revision: u64,
        deadline: i64,
        action: Action,
        expected_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            deadline >= now && deadline <= now + 120,
            VaultError::Expired
        );
        let s = &mut ctx.accounts.ledger;
        require!(s.revision == expected_revision, VaultError::Revision);
        let wallet_before = s.book.balances[0];
        s.book.apply(action)?;
        let actual = solana_sha256_hasher::hash(&s.book.try_to_vec()?).to_bytes();
        require!(actual == expected_hash, VaultError::Projection);
        let state_key = s.key();
        let bump = ctx.bumps.bank;
        let seeds: &[&[u8]] = &[b"bank", state_key.as_ref(), &[bump]];
        for (i, w, p) in [
            (
                0,
                ctx.accounts.wallet_cash.to_account_info(),
                ctx.accounts.pool_cash.to_account_info(),
            ),
            (
                1,
                ctx.accounts.wallet_stock.to_account_info(),
                ctx.accounts.pool_stock.to_account_info(),
            ),
        ] {
            let after = s.book.balances[0][i];
            let before = wallet_before[i];
            if after > before {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: p,
                            to: w,
                            authority: ctx.accounts.bank.to_account_info(),
                        },
                        &[seeds],
                    ),
                    after - before,
                )?;
            } else if after < before {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: w,
                            to: p,
                            authority: ctx.accounts.owner.to_account_info(),
                        },
                    ),
                    before - after,
                )?;
            }
        }
        ctx.accounts.pool_cash.reload()?;
        ctx.accounts.pool_stock.reload()?;
        let totals = s.book.totals();
        require!(
            ctx.accounts.pool_cash.amount as u128 >= totals[0] - s.book.balances[0][0] as u128
                && ctx.accounts.pool_stock.amount as u128
                    >= totals[1] - s.book.balances[0][1] as u128,
            VaultError::Backing
        );
        s.revision = s
            .revision
            .checked_add(1)
            .ok_or(error!(VaultError::Revision))?;
        emit!(Executed {
            ledger: s.key(),
            revision: s.revision,
            state_hash: actual
        });
        Ok(())
    }
}
#[account]
pub struct Ledger {
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub cash_mint: Pubkey,
    pub stock_mint: Pubkey,
    pub revision: u64,
    pub book: Book,
}
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(zero)]
    pub ledger: Box<Account<'info, Ledger>>,
    pub owner: Signer<'info>,
    #[account(address=OPERATOR)]
    pub operator: Signer<'info>,
    pub cash_mint: Account<'info, Mint>,
    pub stock_mint: Account<'info, Mint>,
    /// CHECK: PDA authority used only by the SPL token program.
    #[account(seeds=[b"bank",ledger.key().as_ref()],bump)]
    pub bank: UncheckedAccount<'info>,
    #[account(token::mint=cash_mint,token::authority=bank)]
    pub pool_cash: Account<'info, TokenAccount>,
    #[account(token::mint=stock_mint,token::authority=bank)]
    pub pool_stock: Account<'info, TokenAccount>,
    #[account(token::mint=cash_mint,token::authority=owner)]
    pub wallet_cash: Account<'info, TokenAccount>,
    #[account(token::mint=stock_mint,token::authority=owner)]
    pub wallet_stock: Account<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(mut,has_one=owner,has_one=operator,has_one=cash_mint,has_one=stock_mint)]
    pub ledger: Box<Account<'info, Ledger>>,
    pub owner: Signer<'info>,
    pub operator: Signer<'info>,
    pub cash_mint: Account<'info, Mint>,
    pub stock_mint: Account<'info, Mint>,
    /// CHECK: PDA authority constrained to this ledger.
    #[account(seeds=[b"bank",ledger.key().as_ref()],bump)]
    pub bank: UncheckedAccount<'info>,
    #[account(mut,token::mint=cash_mint,token::authority=bank)]
    pub pool_cash: Account<'info, TokenAccount>,
    #[account(mut,token::mint=stock_mint,token::authority=bank)]
    pub pool_stock: Account<'info, TokenAccount>,
    #[account(mut,token::mint=cash_mint,token::authority=owner)]
    pub wallet_cash: Account<'info, TokenAccount>,
    #[account(mut,token::mint=stock_mint,token::authority=owner)]
    pub wallet_stock: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[event]
pub struct Executed {
    pub ledger: Pubkey,
    pub revision: u64,
    pub state_hash: [u8; 32],
}
#[error_code]
pub enum VaultError {
    #[msg("Invalid contract, replay date, quantity, or position limit")]
    InvalidTerms,
    #[msg("Insufficient asset balance")]
    Balance,
    #[msg("Collateral obligations exceed available assets")]
    Collateral,
    #[msg("Asset conservation failed")]
    Conservation,
    #[msg("Position is not active")]
    Position,
    #[msg("Wrong test token mint")]
    Mint,
    #[msg("SPL escrow does not back all claims")]
    Backing,
    #[msg("Quote expired")]
    Expired,
    #[msg("Vault revision changed")]
    Revision,
    #[msg("Backend projection differs from program execution")]
    Projection,
}
