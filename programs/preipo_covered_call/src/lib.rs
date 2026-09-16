#![allow(unexpected_cfgs)]
//! Fractional, physically settled covered calls on pre-IPO sponsor tokens.
//!
//! Why this is a separate program: the existing `oddlot` program is driven by
//! a fixed OPERATOR key over two 6-decimal test mints it controls. This one
//! takes arbitrary Token-2022 sponsor mints, is signed by real user wallets,
//! and has no privileged operator at all.
//!
//! Design rules enforced here:
//!   * Terms are immutable once created and stored as TOTALS in base units.
//!   * The seller escrows the whole underlying quantity up front.
//!   * The buyer pays the exercise total at exercise time; no prefunding.
//!   * Expiry recovery is permissionless to call and needs no backend.
//!   * Mints and token accounts are pinned, so no substitution is possible.
//!   * All state changes go through a status machine that cannot repeat.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("PreCa11111111111111111111111111111111111111");

pub const OFFER_SEED: &[u8] = b"offer";
pub const ESCROW_SEED: &[u8] = b"escrow";

#[program]
pub mod preipo_covered_call {
    use super::*;

    /// Seller publishes an offer and escrows the entire underlying quantity.
    ///
    /// `underlying_amount` is the amount that must LAND in escrow. When the
    /// mint charges a transfer fee the seller is debited more than that; the
    /// program verifies the escrow balance actually rose by the full amount
    /// rather than trusting the instruction argument.
    pub fn create(
        ctx: Context<Create>,
        offer_id: u64,
        underlying_amount: u64,
        total_exercise_payment: u64,
        total_premium: u64,
        acceptance_deadline: i64,
        exercise_expiry: i64,
        designated_buyer: Option<Pubkey>,
    ) -> Result<()> {
        require!(underlying_amount > 0, CallError::ZeroAmount);
        require!(total_exercise_payment > 0, CallError::ZeroAmount);
        require!(total_premium > 0, CallError::ZeroAmount);
        require!(
            ctx.accounts.underlying_mint.key() != ctx.accounts.usdc_mint.key(),
            CallError::MintMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        require!(acceptance_deadline > now, CallError::DeadlinePassed);
        // Accepting a contract that can never be exercised is not a trade.
        require!(
            acceptance_deadline <= exercise_expiry,
            CallError::DeadlineOrder
        );

        // Reject any mint whose extensions would let a third party move,
        // freeze or halt escrowed collateral. Checked on chain, because the
        // interface cannot be trusted to have checked.
        assert_escrowable(&ctx.accounts.underlying_mint.to_account_info())?;

        let before = ctx.accounts.escrow.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.seller_underlying.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            gross_for_net(&ctx.accounts.underlying_mint, underlying_amount)?,
            ctx.accounts.underlying_mint.decimals,
        )?;

        ctx.accounts.escrow.reload()?;
        let landed = ctx
            .accounts
            .escrow
            .amount
            .checked_sub(before)
            .ok_or(CallError::Overflow)?;
        require!(landed == underlying_amount, CallError::EscrowShortfall);

        let offer = &mut ctx.accounts.offer;
        offer.offer_id = offer_id;
        offer.seller = ctx.accounts.seller.key();
        offer.buyer = Pubkey::default();
        offer.designated_buyer = designated_buyer.unwrap_or_default();
        offer.underlying_mint = ctx.accounts.underlying_mint.key();
        offer.usdc_mint = ctx.accounts.usdc_mint.key();
        offer.token_program = ctx.accounts.token_program.key();
        offer.escrow = ctx.accounts.escrow.key();
        offer.seller_usdc = ctx.accounts.seller_usdc.key();
        offer.underlying_amount = underlying_amount;
        offer.total_exercise_payment = total_exercise_payment;
        offer.total_premium = total_premium;
        offer.acceptance_deadline = acceptance_deadline;
        offer.exercise_expiry = exercise_expiry;
        offer.status = Status::Open as u8;
        offer.bump = ctx.bumps.offer;
        offer.escrow_bump = ctx.bumps.escrow;
        emit!(OfferCreated {
            offer: offer.key(),
            seller: offer.seller,
            underlying_mint: offer.underlying_mint,
            underlying_amount,
            total_exercise_payment,
            total_premium,
        });
        Ok(())
    }

    /// Buyer pays the premium to the seller and becomes the fixed counterparty.
    pub fn accept(ctx: Context<Accept>) -> Result<()> {
        let offer = &mut ctx.accounts.offer;
        require!(offer.status == Status::Open as u8, CallError::BadStatus);

        let now = Clock::get()?.unix_timestamp;
        require!(now <= offer.acceptance_deadline, CallError::DeadlinePassed);

        if offer.designated_buyer != Pubkey::default() {
            require!(
                offer.designated_buyer == ctx.accounts.buyer.key(),
                CallError::NotDesignated
            );
        }
        // A seller accepting their own offer would let them recycle premium.
        require!(
            ctx.accounts.buyer.key() != offer.seller,
            CallError::SelfDeal
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.seller_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            offer.total_premium,
            ctx.accounts.usdc_mint.decimals,
        )?;

        offer.buyer = ctx.accounts.buyer.key();
        offer.buyer_underlying = ctx.accounts.buyer_underlying.key();
        offer.status = Status::Accepted as u8;
        offer.accepted_at = now;
        emit!(OfferAccepted {
            offer: offer.key(),
            buyer: offer.buyer,
            total_premium: offer.total_premium,
        });
        Ok(())
    }

    /// Seller withdraws an offer nobody has accepted.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        // Only while unaccepted. Once accepted the buyer has paid for the
        // right to exercise and the seller cannot take it back.
        require!(offer.status == Status::Open as u8, CallError::BadStatus);

        let amount = ctx.accounts.escrow.amount;
        release_escrow(
            amount,
            &ctx.accounts.offer,
            &ctx.accounts.escrow,
            &ctx.accounts.underlying_mint,
            &ctx.accounts.seller_underlying,
            &ctx.accounts.token_program,
        )?;

        let offer = &mut ctx.accounts.offer;
        offer.status = Status::Cancelled as u8;
        emit!(OfferClosed {
            offer: offer.key(),
            status: offer.status
        });
        Ok(())
    }

    /// Accepted buyer pays the full exercise total and receives every
    /// escrowed token in the same instruction.
    pub fn exercise(ctx: Context<Exercise>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        require!(offer.status == Status::Accepted as u8, CallError::BadStatus);
        require!(offer.buyer == ctx.accounts.buyer.key(), CallError::NotBuyer);

        // Exercisable from acceptance until strictly before expiry.
        let now = Clock::get()?.unix_timestamp;
        require!(now < offer.exercise_expiry, CallError::Expired);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.seller_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            offer.total_exercise_payment,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let amount = ctx.accounts.escrow.amount;
        require!(amount == offer.underlying_amount, CallError::EscrowShortfall);
        release_escrow(
            amount,
            &ctx.accounts.offer,
            &ctx.accounts.escrow,
            &ctx.accounts.underlying_mint,
            &ctx.accounts.buyer_underlying,
            &ctx.accounts.token_program,
        )?;

        let offer = &mut ctx.accounts.offer;
        offer.status = Status::Exercised as u8;
        emit!(OfferClosed {
            offer: offer.key(),
            status: offer.status
        });
        Ok(())
    }

    /// After expiry, return the underlying to the seller.
    ///
    /// Permissionless on purpose: anyone may call it and the tokens can only
    /// go to the seller's pinned account, so recovery never depends on our
    /// backend being alive.
    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        require!(
            offer.status == Status::Open as u8 || offer.status == Status::Accepted as u8,
            CallError::BadStatus
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now >= offer.exercise_expiry, CallError::NotExpired);

        let amount = ctx.accounts.escrow.amount;
        release_escrow(
            amount,
            &ctx.accounts.offer,
            &ctx.accounts.escrow,
            &ctx.accounts.underlying_mint,
            &ctx.accounts.seller_underlying,
            &ctx.accounts.token_program,
        )?;

        let offer = &mut ctx.accounts.offer;
        offer.status = Status::Expired as u8;
        emit!(OfferClosed {
            offer: offer.key(),
            status: offer.status
        });
        Ok(())
    }
}

// ---------------------------------------------------------------- helpers

/// Move `amount` out of escrow under the offer PDA's authority.
fn release_escrow<'info>(
    amount: u64,
    offer: &Account<'info, Offer>,
    escrow: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let id = offer.offer_id.to_le_bytes();
    let seeds: &[&[u8]] = &[OFFER_SEED, offer.seller.as_ref(), &id, &[offer.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: escrow.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: offer.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

/// Gross amount to send so that exactly `net` lands, given the mint's
/// transfer fee. Mirrors Token-2022's ceil(amount * bps / 10_000).
fn gross_for_net(mint: &InterfaceAccount<Mint>, net: u64) -> Result<u64> {
    let info = mint.to_account_info();
    let data = info.try_borrow_data()?;
    let Ok(state) = StateWithExtensions::<
        anchor_spl::token_2022::spl_token_2022::state::Mint,
    >::unpack(&data) else {
        return Ok(net); // plain SPL Token mint: no fee
    };
    let Ok(config) = state.get_extension::<TransferFeeConfig>() else {
        return Ok(net);
    };
    let epoch = Clock::get()?.epoch;
    let fee = config.get_epoch_fee(epoch);
    let bps = u16::from(fee.transfer_fee_basis_points) as u128;
    if bps == 0 {
        return Ok(net);
    }
    require!(bps < 10_000, CallError::FeeTooLarge);
    let maximum = u64::from(fee.maximum_fee) as u128;
    // Invert ceil(g * bps / 10000) = g - net  =>  g = ceil(net * 10000 / (10000 - bps))
    let gross = (net as u128 * 10_000).div_ceil(10_000 - bps);
    let charged = (gross * bps).div_ceil(10_000).min(maximum);
    let gross = net as u128 + charged;
    u64::try_from(gross).map_err(|_| CallError::Overflow.into())
}

/// Reject mints whose extensions defeat escrow guarantees.
fn assert_escrowable(info: &AccountInfo) -> Result<()> {
    use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType as X;
    let data = info.try_borrow_data()?;
    let Ok(state) = StateWithExtensions::<
        anchor_spl::token_2022::spl_token_2022::state::Mint,
    >::unpack(&data) else {
        return Ok(()); // plain SPL Token mint has no extensions
    };
    for ext in state.get_extension_types().unwrap_or_default() {
        match ext {
            // Handled: fee-aware math, or purely descriptive.
            X::TransferFeeConfig
            | X::MetadataPointer
            | X::TokenMetadata
            | X::GroupPointer
            | X::GroupMemberPointer
            | X::ImmutableOwner
            | X::DefaultAccountState => {}
            // The issuer could move, halt or re-denominate escrowed tokens.
            X::PermanentDelegate => return err!(CallError::PermanentDelegate),
            X::TransferHook => return err!(CallError::TransferHook),
            X::Pausable => return err!(CallError::Pausable),
            X::NonTransferable => return err!(CallError::NonTransferable),
            X::ScaledUiAmount => return err!(CallError::ScaledUiAmount),
            X::ConfidentialTransferMint | X::ConfidentialTransferFeeConfig => {
                return err!(CallError::ConfidentialTransfer)
            }
            _ => return err!(CallError::UnsupportedExtension),
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ state

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Open = 0,
    Accepted = 1,
    Exercised = 2,
    Cancelled = 3,
    Expired = 4,
}

#[account]
pub struct Offer {
    pub offer_id: u64,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub designated_buyer: Pubkey,
    pub underlying_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub token_program: Pubkey,
    pub escrow: Pubkey,
    pub seller_usdc: Pubkey,
    pub buyer_underlying: Pubkey,
    pub underlying_amount: u64,
    pub total_exercise_payment: u64,
    pub total_premium: u64,
    pub acceptance_deadline: i64,
    pub exercise_expiry: i64,
    pub accepted_at: i64,
    pub status: u8,
    pub bump: u8,
    pub escrow_bump: u8,
}

impl Offer {
    pub const SIZE: usize = 8 + 8 + 32 * 8 + 8 * 3 + 8 * 3 + 1 + 1 + 1;
}

// --------------------------------------------------------------- contexts

#[derive(Accounts)]
#[instruction(offer_id: u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init,
        payer = seller,
        space = Offer::SIZE,
        seeds = [OFFER_SEED, seller.key().as_ref(), &offer_id.to_le_bytes()],
        bump
    )]
    pub offer: Account<'info, Offer>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = seller_underlying.mint == underlying_mint.key() @ CallError::MintMismatch,
        constraint = seller_underlying.owner == seller.key() @ CallError::WrongOwner,
    )]
    pub seller_underlying: InterfaceAccount<'info, TokenAccount>,
    /// Where premium and exercise payment are delivered. Pinned now so it
    /// cannot be swapped at accept or exercise time.
    #[account(
        constraint = seller_usdc.mint == usdc_mint.key() @ CallError::MintMismatch,
        constraint = seller_usdc.owner == seller.key() @ CallError::WrongOwner,
    )]
    pub seller_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = seller,
        seeds = [ESCROW_SEED, offer.key().as_ref()],
        bump,
        token::mint = underlying_mint,
        token::authority = offer,
        token::token_program = token_program,
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Accept<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = usdc_mint @ CallError::MintMismatch)]
    pub offer: Account<'info, Offer>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = buyer_usdc.mint == usdc_mint.key() @ CallError::MintMismatch,
        constraint = buyer_usdc.owner == buyer.key() @ CallError::WrongOwner,
    )]
    pub buyer_usdc: InterfaceAccount<'info, TokenAccount>,
    /// Pinned at acceptance so exercise cannot redirect delivery.
    #[account(
        constraint = buyer_underlying.mint == offer.underlying_mint @ CallError::MintMismatch,
        constraint = buyer_underlying.owner == buyer.key() @ CallError::WrongOwner,
    )]
    pub buyer_underlying: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        address = offer.seller_usdc @ CallError::AccountSubstitution,
    )]
    pub seller_usdc: InterfaceAccount<'info, TokenAccount>,
    pub usdc_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        has_one = seller @ CallError::NotSeller,
        has_one = underlying_mint @ CallError::MintMismatch,
    )]
    pub offer: Account<'info, Offer>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = offer.escrow @ CallError::AccountSubstitution)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_underlying.mint == underlying_mint.key() @ CallError::MintMismatch,
        constraint = seller_underlying.owner == seller.key() @ CallError::WrongOwner,
    )]
    pub seller_underlying: InterfaceAccount<'info, TokenAccount>,
    #[account(address = offer.token_program @ CallError::AccountSubstitution)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Exercise<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = underlying_mint @ CallError::MintMismatch,
        has_one = usdc_mint @ CallError::MintMismatch,
    )]
    pub offer: Account<'info, Offer>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = offer.escrow @ CallError::AccountSubstitution)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = offer.buyer_underlying @ CallError::AccountSubstitution)]
    pub buyer_underlying: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = buyer_usdc.mint == usdc_mint.key() @ CallError::MintMismatch,
        constraint = buyer_usdc.owner == buyer.key() @ CallError::WrongOwner,
    )]
    pub buyer_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = offer.seller_usdc @ CallError::AccountSubstitution)]
    pub seller_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(address = offer.token_program @ CallError::AccountSubstitution)]
    pub token_program: Interface<'info, TokenInterface>,
    pub usdc_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Expire<'info> {
    /// Permissionless: expiry recovery must not depend on any one signer.
    pub cranker: Signer<'info>,
    #[account(mut, has_one = underlying_mint @ CallError::MintMismatch)]
    pub offer: Account<'info, Offer>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = offer.escrow @ CallError::AccountSubstitution)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    /// Can only ever be the seller's own account.
    #[account(
        mut,
        constraint = seller_underlying.mint == underlying_mint.key() @ CallError::MintMismatch,
        constraint = seller_underlying.owner == offer.seller @ CallError::WrongOwner,
    )]
    pub seller_underlying: InterfaceAccount<'info, TokenAccount>,
    #[account(address = offer.token_program @ CallError::AccountSubstitution)]
    pub token_program: Interface<'info, TokenInterface>,
}

// --------------------------------------------------------------- events

#[event]
pub struct OfferCreated {
    pub offer: Pubkey,
    pub seller: Pubkey,
    pub underlying_mint: Pubkey,
    pub underlying_amount: u64,
    pub total_exercise_payment: u64,
    pub total_premium: u64,
}

#[event]
pub struct OfferAccepted {
    pub offer: Pubkey,
    pub buyer: Pubkey,
    pub total_premium: u64,
}

#[event]
pub struct OfferClosed {
    pub offer: Pubkey,
    pub status: u8,
}

#[error_code]
pub enum CallError {
    #[msg("Amounts must be greater than zero.")]
    ZeroAmount,
    #[msg("Underlying and USDC mints must differ.")]
    MintMismatch,
    #[msg("Token account owner is not the expected party.")]
    WrongOwner,
    #[msg("A pinned account was substituted.")]
    AccountSubstitution,
    #[msg("The offer is not in a state that allows this action.")]
    BadStatus,
    #[msg("The acceptance deadline has passed.")]
    DeadlinePassed,
    #[msg("Acceptance deadline must be on or before the exercise expiry.")]
    DeadlineOrder,
    #[msg("Only the designated buyer may accept this offer.")]
    NotDesignated,
    #[msg("The seller cannot accept their own offer.")]
    SelfDeal,
    #[msg("Only the seller may do this.")]
    NotSeller,
    #[msg("Only the accepted buyer may exercise.")]
    NotBuyer,
    #[msg("The exercise window has closed.")]
    Expired,
    #[msg("The offer has not expired yet.")]
    NotExpired,
    #[msg("The escrow did not receive the full underlying amount.")]
    EscrowShortfall,
    #[msg("Arithmetic overflow.")]
    Overflow,
    #[msg("Transfer fee basis points must be below 10000.")]
    FeeTooLarge,
    #[msg("Mint has a permanent delegate; escrow cannot be guaranteed.")]
    PermanentDelegate,
    #[msg("Mint has a transfer hook; transfers are issuer-controlled.")]
    TransferHook,
    #[msg("Mint is pausable; expiry recovery could be blocked.")]
    Pausable,
    #[msg("Mint is non-transferable.")]
    NonTransferable,
    #[msg("Mint has a mutable scaled UI amount multiplier.")]
    ScaledUiAmount,
    #[msg("Mint supports confidential transfers.")]
    ConfidentialTransfer,
    #[msg("Mint uses an extension this program has not reviewed.")]
    UnsupportedExtension,
}
