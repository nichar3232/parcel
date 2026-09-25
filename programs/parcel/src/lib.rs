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
mod curves;
pub mod economics;
mod market;
use economics::{Action, Book, Tick, A};
// Each deployment declares its own id. The private validator's program keeps
// the id its recorded audit evidence was produced under; the public devnet
// deployment is a separate, independently keyed program. Build the devnet
// artifact with `--features devnet`; the two are never the same binary.
#[cfg(not(feature = "devnet"))]
declare_id!("GmWcUUpydUumJ5eSaXzN7SVryLjD6vvaJMDtj3W3Wcbx");
#[cfg(feature = "devnet")]
declare_id!("FwEY5cM9vP31LwywoJu1XWQ1nvBeNh2aMsVVpbYayRvC");
// Dedicated no-value test operators, one per ledger. Neither is a permissionless
// oracle. Devnet's first operator was lost with trading-01 on 2026-09-23, which
// stranded A4NTJ45B…; the redeploy has its own key rather than sharing the
// validator's.
#[cfg(not(feature = "devnet"))]
const OPERATOR: Pubkey = pubkey!("8oheEujy8FS7Nr3bdYT7okWbWeMy3Tp5eM8z4YwRTzfq");
#[cfg(feature = "devnet")]
const OPERATOR: Pubkey = pubkey!("7K12outW8HdaD7McqqGD2nTJW55nd7eYeqxMLVZZiQtS");
#[program]
pub mod parcel {
    use super::*;
    /// Open a vault. The remaining accounts are its mints: cash, then every
    /// stock in book order. Each is a six-decimal no-value test mint under
    /// the operator. Escrow is checked as it is drawn on, per asset, in
    /// `execute_v4`.
    pub fn initialize_v4<'info>(ctx: Context<'_, '_, 'info, 'info, Initialize<'info>>) -> Result<()> {
        require!(ctx.remaining_accounts.len() == A, VaultError::Mint);
        let mut mints = [Pubkey::default(); A];
        for (i, info) in ctx.remaining_accounts.iter().enumerate() {
            let mint = Account::<Mint>::try_from(info).map_err(|_| error!(VaultError::Mint))?;
            require!(
                mint.decimals == 6 && mint.mint_authority == Some(OPERATOR).into(),
                VaultError::Mint
            );
            require!(!mints[..i].contains(&info.key()), VaultError::Mint);
            mints[i] = info.key();
        }
        let s = &mut ctx.accounts.ledger;
        s.owner = ctx.accounts.owner.key();
        s.operator = ctx.accounts.operator.key();
        s.mints = mints;
        s.revision = 0;
        s.book = Book::initial();
        Ok(())
    }
    /// One action. The wallet and pool token accounts are the asset the
    /// action moves between wallet and vault (cash when it moves nothing);
    /// no other asset may leave or enter the wallet in the same action.
    pub fn execute_v4(
        ctx: Context<Execute>,
        expected_revision: u64,
        deadline: i64,
        tick: Option<Tick>,
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
        let mint = ctx.accounts.wallet.mint;
        require!(ctx.accounts.pool.mint == mint, VaultError::Mint);
        let asset = s
            .mints
            .iter()
            .position(|m| *m == mint)
            .ok_or(error!(VaultError::Mint))?;
        let wallet_before = s.book.balances[0];
        s.book.execute(tick, action)?;
        let actual = solana_sha256_hasher::hash(&s.book.try_to_vec()?).to_bytes();
        require!(actual == expected_hash, VaultError::Projection);
        let wallet_after = s.book.balances[0];
        for i in 0..A {
            require!(i == asset || wallet_after[i] == wallet_before[i], VaultError::Mint);
        }
        let state_key = s.key();
        let bump = ctx.bumps.bank;
        let seeds: &[&[u8]] = &[b"bank", state_key.as_ref(), &[bump]];
        let (after, before) = (wallet_after[asset], wallet_before[asset]);
        if after > before {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.pool.to_account_info(),
                        to: ctx.accounts.wallet.to_account_info(),
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
                        from: ctx.accounts.wallet.to_account_info(),
                        to: ctx.accounts.pool.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                before - after,
            )?;
        }
        ctx.accounts.pool.reload()?;
        let totals = s.book.totals();
        require!(
            ctx.accounts.pool.amount as u128 >= totals[asset] - s.book.balances[0][asset] as u128,
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
// Version four holds every stock the desk writes on in one book, with a
// mint per asset. The layout differs from version three, so the account and
// instructions are renamed: a version-three ledger or client fails on its
// discriminator instead of being read as the wrong layout.
#[account]
pub struct LedgerV4 {
    pub owner: Pubkey,
    pub operator: Pubkey,
    /// Cash, then every stock in book order.
    pub mints: [Pubkey; A],
    pub revision: u64,
    pub book: Book,
}
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(zero)]
    pub ledger: Box<Account<'info, LedgerV4>>,
    pub owner: Signer<'info>,
    #[account(address=OPERATOR)]
    pub operator: Signer<'info>,
    /// CHECK: PDA authority used only by the SPL token program.
    #[account(seeds=[b"bank",ledger.key().as_ref()],bump)]
    pub bank: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(mut,has_one=owner,has_one=operator)]
    pub ledger: Box<Account<'info, LedgerV4>>,
    pub owner: Signer<'info>,
    pub operator: Signer<'info>,
    /// CHECK: PDA authority constrained to this ledger.
    #[account(seeds=[b"bank",ledger.key().as_ref()],bump)]
    pub bank: UncheckedAccount<'info>,
    /// The owner's token account for the asset this action moves.
    #[account(mut,token::authority=owner)]
    pub wallet: Account<'info, TokenAccount>,
    /// The vault's escrow for the same asset.
    #[account(mut,token::authority=bank)]
    pub pool: Account<'info, TokenAccount>,
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
