#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
declare_id!("3VpPpDGYjxawotjb6xMYdUsZoazszT7NLb1wgVod9Xcm");
const UNIT:u128=1_000_000;
#[program]
pub mod strata {
 use super::*;
 pub fn create_market(ctx:Context<CreateMarket>,args:MarketArgs)->Result<()> {
  require!(ctx.accounts.mint.decimals==6,DeskError::WrongMint);
  require!(args.price>0 && args.price<=1_000_000_000_000 && args.available_at>Clock::get()?.unix_timestamp && args.historical_at>0,DeskError::InvalidTerms);
  let m=&mut ctx.accounts.market;m.authority=ctx.accounts.authority.key();m.mint=ctx.accounts.mint.key();m.feed=args.feed;m.dataset=args.dataset;m.price=args.price;m.historical_at=args.historical_at;m.available_at=args.available_at;m.published=false;m.policy=1;Ok(())
 }
 pub fn fund_offer(ctx:Context<FundOffer>,args:OfferArgs)->Result<()> {
  let now=Clock::get()?.unix_timestamp;
  require!(args.kind<=1 && args.low>0 && args.high>args.low && args.high<=1_000_000_000_000 && args.quantity>0 && args.quantity<=1_000_000_000,DeskError::InvalidTerms);
  require!(args.deadline>now && args.deadline<ctx.accounts.market.available_at && args.expiry==ctx.accounts.market.available_at && args.expiry<=now+2_592_000,DeskError::Expired);
  require!(ctx.accounts.maker.key()!=args.taker,DeskError::WrongParty);
  let reserve=amount(args.high-args.low,args.quantity)?;
  require!(reserve>0 && args.premium<=reserve,DeskError::InvalidTerms);
  let o=&mut ctx.accounts.offer;
  o.maker=ctx.accounts.maker.key();o.taker=args.taker;o.market=ctx.accounts.market.key();o.mint=ctx.accounts.mint.key();o.vault=ctx.accounts.vault.key();o.nonce=args.nonce;o.kind=args.kind;o.low=args.low;o.high=args.high;o.quantity=args.quantity;o.premium=args.premium;o.expiry=args.expiry;o.deadline=args.deadline;o.reserve=reserve;o.status=0;o.buyer_payout=0;o.buyer_claimed=false;o.maker_claimed=false;o.bump=ctx.bumps.offer;
  token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(),Transfer{from:ctx.accounts.maker_cash.to_account_info(),to:ctx.accounts.vault.to_account_info(),authority:ctx.accounts.maker.to_account_info()}),reserve)?;
  emit!(Lifecycle{offer:o.key(),state:0,amount:reserve});Ok(())
 }
 pub fn accept_offer(ctx:Context<AcceptOffer>,expected:OfferArgs)->Result<()> {
  let o=&mut ctx.accounts.offer;
  require!(o.status==0,DeskError::WrongState);
  require!(Clock::get()?.unix_timestamp<o.deadline,DeskError::Expired);
  require!(o.nonce==expected.nonce && o.kind==expected.kind && o.low==expected.low && o.high==expected.high && o.quantity==expected.quantity && o.premium==expected.premium && o.expiry==expected.expiry && o.deadline==expected.deadline && o.taker==expected.taker,DeskError::ChangedTerms);
  require!(ctx.accounts.vault.amount>=o.reserve,DeskError::Underfunded);
  token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(),Transfer{from:ctx.accounts.taker_cash.to_account_info(),to:ctx.accounts.maker_cash.to_account_info(),authority:ctx.accounts.taker.to_account_info()}),o.premium)?;
  o.status=1;emit!(Lifecycle{offer:o.key(),state:1,amount:o.premium});Ok(())
 }
 pub fn cancel_offer(ctx:Context<CancelOffer>)->Result<()> {
  let o=&ctx.accounts.offer;require!(o.status==0,DeskError::WrongState);
  let nonce=o.nonce.to_le_bytes();let bump=[o.bump];let seeds:&[&[u8]]=&[b"offer",o.maker.as_ref(),&nonce,&bump];
  token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),Transfer{from:ctx.accounts.vault.to_account_info(),to:ctx.accounts.maker_cash.to_account_info(),authority:o.to_account_info()},&[seeds]),o.reserve)?;
  ctx.accounts.offer.status=4;Ok(())
 }
 pub fn publish_observation(ctx:Context<PublishObservation>,feed:[u8;32],historical_at:i64,confidence_bps:u16)->Result<()> {
  let m=&mut ctx.accounts.market;
  require!(Clock::get()?.unix_timestamp>=m.available_at,DeskError::TooEarly);
  require!(feed==m.feed && historical_at==m.historical_at && confidence_bps<=50,DeskError::InvalidObservation);
  m.published=true;Ok(())
 }
 pub fn settle(ctx:Context<Settle>)->Result<()> {
  let o=&mut ctx.accounts.offer;
  if o.status==3 {return Ok(());}
  require!(o.status==1 || o.status==2,DeskError::WrongState);
  require!(Clock::get()?.unix_timestamp>=o.expiry,DeskError::TooEarly);
  if !ctx.accounts.market.published {o.status=2;emit!(Lifecycle{offer:o.key(),state:2,amount:0});return Ok(());}
  let price=ctx.accounts.market.price;
  let intrinsic=if o.kind==0 {o.high.saturating_sub(price).min(o.high-o.low)} else {price.saturating_sub(o.low).min(o.high-o.low)};
  o.buyer_payout=amount(intrinsic,o.quantity)?;
  require!(o.buyer_payout<=o.reserve,DeskError::Underfunded);
  o.status=3;emit!(Lifecycle{offer:o.key(),state:3,amount:o.buyer_payout});Ok(())
 }
 pub fn claim(ctx:Context<Claim>)->Result<()> {
  let o=&ctx.accounts.offer;require!(o.status==3,DeskError::WrongState);
  let buyer=ctx.accounts.owner.key()==o.taker;
  require!(buyer || ctx.accounts.owner.key()==o.maker,DeskError::WrongParty);
  require!(if buyer {!o.buyer_claimed} else {!o.maker_claimed},DeskError::AlreadyClaimed);
  let value=if buyer {o.buyer_payout} else {o.reserve.checked_sub(o.buyer_payout).ok_or(DeskError::Overflow)?};
  let nonce=o.nonce.to_le_bytes();let bump=[o.bump];let seeds:&[&[u8]]=&[b"offer",o.maker.as_ref(),&nonce,&bump];
  token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),Transfer{from:ctx.accounts.vault.to_account_info(),to:ctx.accounts.destination.to_account_info(),authority:o.to_account_info()},&[seeds]),value)?;
  let o=&mut ctx.accounts.offer;if buyer{o.buyer_claimed=true;}else{o.maker_claimed=true;}emit!(Lifecycle{offer:o.key(),state:if buyer{5}else{6},amount:value});Ok(())
 }
}
fn amount(price:u64,quantity:u64)->Result<u64>{u64::try_from((price as u128).checked_mul(quantity as u128).ok_or(DeskError::Overflow)?/UNIT).map_err(|_|error!(DeskError::Overflow))}
#[derive(AnchorSerialize,AnchorDeserialize,Clone)]
pub struct MarketArgs{pub feed:[u8;32],pub dataset:[u8;32],pub price:u64,pub historical_at:i64,pub available_at:i64}
#[derive(AnchorSerialize,AnchorDeserialize,Clone)]
pub struct OfferArgs{pub nonce:u64,pub taker:Pubkey,pub kind:u8,pub low:u64,pub high:u64,pub quantity:u64,pub premium:u64,pub expiry:i64,pub deadline:i64}
#[account]
#[derive(InitSpace)]
pub struct Market{pub authority:Pubkey,pub mint:Pubkey,pub feed:[u8;32],pub dataset:[u8;32],pub price:u64,pub historical_at:i64,pub available_at:i64,pub published:bool,pub policy:u16}
#[account]
#[derive(InitSpace)]
pub struct Offer{pub maker:Pubkey,pub taker:Pubkey,pub market:Pubkey,pub mint:Pubkey,pub vault:Pubkey,pub nonce:u64,pub kind:u8,pub low:u64,pub high:u64,pub quantity:u64,pub premium:u64,pub expiry:i64,pub deadline:i64,pub reserve:u64,pub status:u8,pub buyer_payout:u64,pub buyer_claimed:bool,pub maker_claimed:bool,pub bump:u8}
#[derive(Accounts)]
pub struct CreateMarket<'info>{#[account(init,payer=authority,space=8+Market::INIT_SPACE)]pub market:Account<'info,Market>,#[account(mut,address=pubkey!("8oheEujy8FS7Nr3bdYT7okWbWeMy3Tp5eM8z4YwRTzfq"))]pub authority:Signer<'info>,pub mint:Account<'info,Mint>,pub system_program:Program<'info,System>}
#[derive(Accounts)]
#[instruction(args:OfferArgs)]
pub struct FundOffer<'info>{
 #[account(init,payer=maker,space=8+Offer::INIT_SPACE,seeds=[b"offer",maker.key().as_ref(),&args.nonce.to_le_bytes()],bump)]pub offer:Account<'info,Offer>,
 pub market:Account<'info,Market>,
 #[account(address=market.mint,constraint=mint.decimals==6 @ DeskError::WrongMint)]pub mint:Account<'info,Mint>,
 #[account(init,payer=maker,seeds=[b"vault",offer.key().as_ref()],bump,token::mint=mint,token::authority=offer)]pub vault:Account<'info,TokenAccount>,
 #[account(mut,token::mint=mint,token::authority=maker)]pub maker_cash:Account<'info,TokenAccount>,
 #[account(mut)]pub maker:Signer<'info>,pub token_program:Program<'info,Token>,pub system_program:Program<'info,System>,pub rent:Sysvar<'info,Rent>
}
#[derive(Accounts)]
pub struct AcceptOffer<'info>{
 #[account(mut,has_one=maker,has_one=taker,has_one=vault)]pub offer:Account<'info,Offer>,
 #[account(address=offer.mint)]pub mint:Account<'info,Mint>,
 #[account(token::mint=mint,token::authority=offer)]pub vault:Account<'info,TokenAccount>,
 #[account(mut,token::mint=mint,token::authority=taker)]pub taker_cash:Account<'info,TokenAccount>,
 #[account(mut,token::mint=mint,token::authority=maker)]pub maker_cash:Account<'info,TokenAccount>,
 pub taker:Signer<'info>,
 /// CHECK: party pinned by has_one; no signature needed to receive premium.
 pub maker:UncheckedAccount<'info>,pub token_program:Program<'info,Token>
}
#[derive(Accounts)]
pub struct CancelOffer<'info>{#[account(mut,has_one=maker,has_one=vault)]pub offer:Account<'info,Offer>,#[account(address=offer.mint)]pub mint:Account<'info,Mint>,#[account(mut,token::mint=mint,token::authority=offer)]pub vault:Account<'info,TokenAccount>,#[account(mut,token::mint=mint,token::authority=maker)]pub maker_cash:Account<'info,TokenAccount>,pub maker:Signer<'info>,pub token_program:Program<'info,Token>}
#[derive(Accounts)]
pub struct PublishObservation<'info>{#[account(mut,has_one=authority)]pub market:Account<'info,Market>,pub authority:Signer<'info>}
#[derive(Accounts)]
pub struct Settle<'info>{#[account(mut,has_one=market)]pub offer:Account<'info,Offer>,pub market:Account<'info,Market>}
#[derive(Accounts)]
pub struct Claim<'info>{#[account(mut,has_one=vault)]pub offer:Account<'info,Offer>,#[account(address=offer.mint)]pub mint:Account<'info,Mint>,#[account(mut,token::mint=mint,token::authority=offer)]pub vault:Account<'info,TokenAccount>,#[account(mut,token::mint=mint,token::authority=owner)]pub destination:Account<'info,TokenAccount>,pub owner:Signer<'info>,pub token_program:Program<'info,Token>}
#[event]pub struct Lifecycle{pub offer:Pubkey,pub state:u8,pub amount:u64}
#[error_code]
pub enum DeskError{#[msg("Invalid bounded trade terms")]InvalidTerms,#[msg("Offer deadline or expiry is invalid")]Expired,#[msg("Action unavailable in this state")]WrongState,#[msg("Wrong wallet for this instruction")]WrongParty,#[msg("Reviewed terms do not match funded offer")]ChangedTerms,#[msg("Escrow is underfunded")]Underfunded,#[msg("Observation time has not arrived")]TooEarly,#[msg("Observation does not match committed sample")]InvalidObservation,#[msg("This claim was already paid")]AlreadyClaimed,#[msg("Arithmetic overflow")]Overflow,#[msg("Unsupported settlement mint")]WrongMint}
#[cfg(test)]mod tests{use super::*;#[test]fn fractional_units(){assert_eq!(amount(20_000_000,125_000).unwrap(),2_500_000);}#[test]fn bounded_math(){for s in 0..1000{let p=(100_u64.saturating_sub(s)).min(20);assert!(p<=20);let v=amount(p*1_000_000,333_333).unwrap();assert!(v<=6_666_660);}}}
