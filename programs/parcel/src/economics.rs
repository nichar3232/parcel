use crate::{curves::Curve, market::*, VaultError};
use anchor_lang::prelude::*;
use std::collections::BTreeMap;
const U: i128 = 1_000_000;
const W: usize = 0;
const V: usize = 1;
const C: usize = 2;
const M: usize = 3;
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Leg {
    pub call: bool,
    pub buy: bool,
    pub strike: u64,
    pub ratio: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Terms {
    pub quantity: u64,
    /// Unix milliseconds, like every date the program holds.
    pub expiry: i64,
    pub physical: bool,
    pub dividend: bool,
    pub legs: Vec<Leg>,
    pub curve: Option<Curve>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct OptionPosition {
    pub id: [u8; 16],
    pub terms: Terms,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Loan {
    pub id: [u8; 16],
    pub quantity: u64,
    pub opened: i64,
    pub expiry: i64,
    pub cap: u64,
    pub interest: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Short {
    pub id: [u8; 16],
    pub quantity: u64,
    pub opened: i64,
    pub expiry: i64,
    pub cap: u64,
    pub interest: u64,
}
/// Cash drawn from the market pool against pledged vault stock (program mint).
/// APR is operator-authorized at open (pool curve is off-chain); interest is
/// not Black–Scholes. Protective stock-loan / short premiums remain BS-priced
/// off-chain and are passed into Lend / Short.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Borrow {
    pub id: [u8; 16],
    pub pledged: u64,
    pub principal: u64,
    /// Annual rate in millionths (1_000_000 = 100%).
    pub apr: u64,
    pub fixed: bool,
    pub opened: i64,
    /// Meaningful only when `fixed`; otherwise ignored (stored as 0).
    pub expiry: i64,
    pub accrued: u64,
    pub accrued_to: i64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Book {
    /// The book's clock, Unix milliseconds: a replay observation, or a live instant.
    pub date: i64,
    /// The underlying's price at `date`: the committed close on the replay,
    /// the operator's attested mark live.
    pub spot: u64,
    pub isolated: bool,
    pub balances: [[u64; 2]; 4],
    pub options: Vec<OptionPosition>,
    pub loans: Vec<Loan>,
    pub shorts: Vec<Short>,
    pub borrows: Vec<Borrow>,
}
/// A price observed at an instant (a settlement close).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Observation {
    pub at: i64,
    pub price: u64,
}
/// The clock moving forward. On the replay every price must equal the
/// committed table, so the operator attests nothing. Past the replay the
/// operator attests the spot at `date` and the closes positions settle at;
/// the program trusts those within `MAX_PRICE` and checks everything else.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Tick {
    pub date: i64,
    pub spot: u64,
    pub closes: Vec<Observation>,
    /// The pool's rate for variable cash loans from here on; 0 keeps theirs.
    pub apr: u64,
    /// Run cash loans (term settlement, accrual, repricing, liquidation).
    pub carry: bool,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum Action {
    Transfer {
        deposit: bool,
        stock: bool,
        amount: u64,
    },
    Stock {
        buy: bool,
        quantity: u64,
        /// The fill: the close on the replay, the live bid or ask.
        price: u64,
    },
    Open {
        id: [u8; 16],
        terms: Terms,
        premium: i64,
    },
    Close {
        id: [u8; 16],
        premium: i64,
    }, // signed cash paid by vault
    Margin {
        isolated: bool,
    },
    Lend {
        id: [u8; 16],
        quantity: u64,
        expiry: i64,
        premium: u64,
    },
    Recall {
        id: [u8; 16],
    },
    Short {
        id: [u8; 16],
        quantity: u64,
        cap: u64,
        expiry: i64,
        premium: u64,
    },
    Cover {
        id: [u8; 16],
    },
    Advance {
        tick: Tick,
    },
    Restart,
    Borrow {
        id: [u8; 16],
        pledged: u64,
        principal: u64,
        apr: u64,
        fixed: bool,
        expiry: i64,
    },
    Repay {
        id: [u8; 16],
    },
}
fn valid(ok: bool) -> Result<()> {
    require!(ok, VaultError::InvalidTerms);
    Ok(())
}
fn mul(a: u64, b: u64) -> u64 {
    ((a as u128 * b as u128) / U as u128) as u64
}
/// NVDA test-reserve parameters (matches `lib/parcel/lending.ts`).
const BORROW_LTV: u128 = 600_000;
const BORROW_LIQ: u128 = 680_000;
const BORROW_BONUS: u128 = 90_000;
fn qty(q: u64) -> Result<()> {
    valid(q > 0 && q <= 1_000_000_000)
}
/// Milliseconds in a 365-day year.
const YEAR: u128 = 365 * 24 * HOUR as u128;
/// The highest price the operator may attest (10,000 USDC), as strikes.
const MAX_PRICE: u64 = 10_000_000_000;
/// Simple interest on a cash loan: principal × apr × ms / (1e6 × year).
fn cash_interest(principal: u64, apr: u64, from: i64, to: i64) -> u64 {
    let elapsed = to.saturating_sub(from).max(0) as u128;
    let n = principal as u128 * apr as u128 * elapsed;
    let d = 1_000_000 * YEAR;
    ((n + d / 2) / d) as u64
}
/// The committed replay close at `at`, if `at` is a replay observation.
pub fn replay(at: i64) -> Option<u64> {
    let rel = at.checked_sub(REPLAY_EPOCH)?;
    if rel < 0 || rel % HOUR != 0 {
        return None;
    }
    let h = u32::try_from(rel / HOUR).ok()?;
    HOURS.iter().position(|&x| x == h).map(|i| PRICES[i])
}
/// Past the replay's last observation: the live market.
fn live(at: i64) -> bool {
    at > REPLAY_EPOCH + REPLAY_HOURS * HOUR
}
/// A price the book may take at `at`: the table on the replay, an attested
/// positive price no higher than `MAX_PRICE` live.
fn attested(at: i64, price: u64) -> Result<()> {
    match replay(at) {
        Some(p) => valid(price == p),
        None => valid(live(at) && price > 0 && price <= MAX_PRICE),
    }
}
/// A date a position can run to from `date`. On the replay it must be an
/// observation, so it has a close to settle at; live, any later instant.
fn schedulable(date: i64, expiry: i64) -> Result<()> {
    valid(expiry > date && (live(date) || replay(expiry).is_some()))
}
/// 3.5% on the entry value over the term, rounded half up.
fn interest(q: u64, entry: u64, from: i64, to: i64) -> u64 {
    let n = mul(q, entry) as u128 * 35 * (to - from) as u128;
    let d = 1000 * YEAR;
    ((n + d / 2) / d) as u64
}
fn accrued(total: u64, from: i64, expiry: i64, at: i64) -> u64 {
    let term = (expiry - from) as u128;
    let elapsed = (at.min(expiry) - from) as u128;
    ((total as u128 * elapsed + term / 2) / term) as u64
}
impl Terms {
    pub fn validate(&self, date: i64) -> Result<()> {
        qty(self.quantity)?;
        schedulable(date, self.expiry)?;
        if let Some(c) = &self.curve {
            valid(self.legs.is_empty() && !self.physical)?;
            c.validate(self.quantity, self.dividend)?;
            if self.dividend {
                valid(self.expiry == DIVIDEND_DATE)?;
            }
            return Ok(());
        }
        valid(!self.legs.is_empty() && self.legs.len() <= 4)?;
        for l in &self.legs {
            valid(l.strike > 0 && l.strike <= 10_000_000_000 && l.ratio > 0 && l.ratio <= 4)?;
        }
        valid(
            self.physical
                || self
                    .legs
                    .iter()
                    .filter(|l| l.call)
                    .map(|l| {
                        if l.buy {
                            l.ratio as i32
                        } else {
                            -(l.ratio as i32)
                        }
                    })
                    .sum::<i32>()
                    == 0,
        )?;
        if self.dividend {
            valid(
                !self.physical
                    && self.expiry == DIVIDEND_DATE
                    && self.legs.iter().all(|l| l.strike <= 100_000),
            )?;
        }
        let b = sweep(&[self], false);
        valid(b[0] != 0 || b[1] != 0)
    }
    fn delivery(&self, p: u64) -> (i128, i128) {
        if let Some(c) = &self.curve {
            return (c.payoff(self.quantity, p), 0);
        }
        let (mut cash, mut shares) = (0, 0);
        for l in &self.legs {
            let q = self.quantity as i128 * l.ratio as i128 * if l.buy { 1 } else { -1 };
            if self.physical {
                if (l.call && p > l.strike) || (!l.call && p < l.strike) {
                    let stock = q * if l.call { 1 } else { -1 };
                    shares += stock;
                    cash -= stock * l.strike as i128 / U;
                }
            } else {
                let intrinsic = if l.call {
                    p.saturating_sub(l.strike)
                } else {
                    l.strike.saturating_sub(p)
                };
                cash += q * intrinsic as i128;
            }
        }
        (if self.physical { cash } else { cash / U }, shares)
    }
}
// Analytic sorted strike sweep: [cash min, cash max, stock min, stock max].
fn sweep(terms: &[&Terms], physical: bool) -> [i128; 4] {
    if terms.len() == 1 {
        if let Some(c) = &terms[0].curve {
            return c.bounds(terms[0].quantity);
        }
    }
    let mut events: BTreeMap<u64, [i128; 5]> = BTreeMap::new();
    let (mut cash, mut stock, mut slope) = (0, 0, 0);
    for t in terms {
        for l in &t.legs {
            let q = t.quantity as i128 * l.ratio as i128 * if l.buy { 1 } else { -1 };
            let k = l.strike as i128;
            let e = events.entry(l.strike).or_insert([0; 5]);
            if !physical {
                if !l.call {
                    cash += q * k;
                    slope -= q;
                }
                e[0] += q;
            } else if !l.call {
                let c = q * k / U;
                cash += c;
                stock -= q;
                e[1] -= c;
                e[2] += q;
            } else {
                e[3] -= q * k / U;
                e[4] += q;
            }
        }
    }
    let mut b = [cash, cash, stock, stock];
    let mut prev = 0;
    let observe = |b: &mut [i128; 4], c: i128, s: i128| {
        b[0] = b[0].min(c);
        b[1] = b[1].max(c);
        b[2] = b[2].min(s);
        b[3] = b[3].max(s);
    };
    for (k, e) in events {
        let k = k as i128;
        if !physical {
            cash += slope * (k - prev);
            observe(&mut b, cash, stock);
            slope += e[0];
        } else {
            cash += e[1];
            stock += e[2];
            observe(&mut b, cash, stock);
            cash += e[3];
            stock += e[4];
            observe(&mut b, cash, stock);
        }
        prev = k;
    }
    if !physical {
        cash += slope * (prev + U);
        observe(&mut b, cash, stock);
        b[0] /= U;
        b[1] /= U;
    }
    b
}
fn envelope(terms: &[&Terms]) -> [i128; 4] {
    if terms.is_empty() {
        return [0; 4];
    }
    if terms.iter().any(|t| t.curve.is_some()) {
        let vanilla: Vec<_> = terms
            .iter()
            .copied()
            .filter(|t| t.curve.is_none())
            .collect();
        let mut b = envelope(&vanilla);
        let mut pairs: BTreeMap<(u64, bool, bool, u64, u64, u64), i128> = BTreeMap::new();
        for t in terms {
            if let Some(c) = &t.curve {
                *pairs
                    .entry((t.quantity, c.exponential, c.up, c.lower, c.upper, c.cap))
                    .or_default() += if c.buy { 1 } else { -1 };
            }
        }
        for ((q, _, _, _, _, cap), count) in pairs {
            let total = mul(q, cap) as i128 * count;
            b[0] += total.min(0);
            b[1] += total.max(0);
        }
        return b;
    }
    let mut b = sweep(terms, terms[0].physical);
    if terms[0].physical || terms.len() == 1 {
        return b;
    }
    let mut functions: BTreeMap<Vec<(bool, u64, i128)>, i128> = BTreeMap::new();
    for t in terms {
        let mut coeff: BTreeMap<(bool, u64), i128> = BTreeMap::new();
        for l in &t.legs {
            *coeff.entry((l.call, l.strike)).or_insert(0) +=
                t.quantity as i128 * l.ratio as i128 * if l.buy { 1 } else { -1 };
        }
        let entries: Vec<_> = coeff.into_iter().filter(|(_, q)| *q != 0).collect();
        if entries.iter().all(|(_, q)| q % U == 0) {
            continue;
        }
        let sign = entries[0].1.signum();
        *functions
            .entry(
                entries
                    .into_iter()
                    .map(|((kind, k), q)| (kind, k, q * sign))
                    .collect(),
            )
            .or_insert(0) += sign;
    }
    let allowance = (functions.values().map(|v| v.abs()).sum::<i128>() - 1).max(0);
    let (mut low, mut high) = (0, 0);
    for t in terms {
        let g = sweep(&[t], false);
        low += g[0].min(0);
        high += g[1].max(0);
    }
    b[0] = (b[0] - allowance).max(low);
    b[1] = (b[1] + allowance).min(high);
    b
}
impl Book {
    pub fn initial() -> Self {
        Self {
            date: REPLAY_EPOCH,
            spot: PRICES[0],
            isolated: false,
            balances: [
                [10_000_000_000, 25_000_000],
                [0, 0],
                [2_000_000_000_000, 10_000_000_000],
                [2_000_000_000_000, 10_000_000_000],
            ],
            options: vec![],
            loans: vec![],
            shorts: vec![],
            borrows: vec![],
        }
    }
    pub fn totals(&self) -> [u128; 2] {
        let mut a = [0; 2];
        for b in self.balances {
            a[0] += b[0] as u128;
            a[1] += b[1] as u128;
        }
        for p in &self.loans {
            a[0] += mul(p.quantity, p.cap) as u128 + p.interest as u128;
        }
        a
    }
    fn transfer(&mut self, from: usize, to: usize, asset: usize, n: i128) -> Result<()> {
        if n < 0 {
            return self.transfer(to, from, asset, -n);
        }
        let n = u64::try_from(n).map_err(|_| error!(VaultError::Balance))?;
        self.balances[from][asset] = self.balances[from][asset]
            .checked_sub(n)
            .ok_or(error!(VaultError::Balance))?;
        self.balances[to][asset] = self.balances[to][asset]
            .checked_add(n)
            .ok_or(error!(VaultError::Balance))?;
        Ok(())
    }
    pub fn reserves(&self) -> [u64; 5] {
        let mut groups: BTreeMap<(i64, bool, bool, usize), Vec<&Terms>> = BTreeMap::new();
        for (i, p) in self.options.iter().enumerate() {
            groups
                .entry((
                    p.terms.expiry,
                    p.terms.physical,
                    p.terms.dividend,
                    if self.isolated { i } else { 0 },
                ))
                .or_default()
                .push(&p.terms);
        }
        let mut r = [0u64; 5];
        let mut calendar: BTreeMap<i64, (i128, i128)> = BTreeMap::new();
        for ts in groups.values() {
            let b = envelope(ts);
            let row = calendar.entry(ts[0].expiry).or_default();
            row.0 += b[0];
            row.1 += b[1];
            r[0] += (-b[0]).max(0) as u64;
            r[1] += (-b[2]).max(0) as u64;
            r[2] += b[1].max(0) as u64;
            r[3] += b[3].max(0) as u64;
        }
        if !self.isolated {
            r[0] = 0;
            r[2] = 0;
            let (mut low, mut high) = (0i128, 0i128);
            for (_, (min, max)) in calendar {
                low += min;
                high += max;
                r[0] = r[0].max((-low).max(0) as u64);
                r[2] = r[2].max(high.max(0) as u64);
            }
        }
        for p in &self.shorts {
            r[0] += mul(p.quantity, p.cap) + p.interest;
            r[3] += p.quantity;
        }
        for p in &self.loans {
            r[4] += p.quantity;
        }
        for p in &self.borrows {
            // Pledged stock cannot be withdrawn, sold or lent while the loan runs.
            r[1] += p.pledged;
        }
        r
    }
    pub fn collateral(&self) -> Result<()> {
        let r = self.reserves();
        require!(
            self.balances[V][0] >= r[0]
                && self.balances[V][1] >= r[1]
                && self.balances[C][0] >= r[2]
                && self.balances[C][1] >= r[3]
                && self.balances[M][1] >= r[4],
            VaultError::Collateral
        );
        Ok(())
    }
    fn future(&self, e: i64) -> Result<()> {
        schedulable(self.date, e)
    }
    fn unique(&self, id: &[u8; 16]) -> Result<()> {
        valid(
            !self.options.iter().any(|p| &p.id == id)
                && !self.loans.iter().any(|p| &p.id == id)
                && !self.shorts.iter().any(|p| &p.id == id)
                && !self.borrows.iter().any(|p| &p.id == id),
        )
    }
    fn recall(&mut self, index: usize, at: i64, spot: u64) -> Result<()> {
        let p = self.loans.remove(index);
        let cost = mul(p.quantity, spot.min(p.cap));
        let earned = accrued(p.interest, p.opened, p.expiry, at);
        self.balances[M][0] += cost;
        self.transfer(M, V, 1, p.quantity as i128)?;
        self.balances[V][0] += earned;
        self.balances[C][0] += mul(p.quantity, p.cap) - cost + p.interest - earned;
        Ok(())
    }
    fn cover(&mut self, index: usize, at: i64, spot: u64) -> Result<()> {
        let p = self.shorts.remove(index);
        let cost = mul(p.quantity, spot.min(p.cap));
        if spot > p.cap {
            self.transfer(V, C, 0, cost as i128)?;
        } else {
            self.transfer(V, M, 0, cost as i128)?;
            self.transfer(M, C, 1, p.quantity as i128)?;
        }
        self.transfer(V, C, 0, accrued(p.interest, p.opened, p.expiry, at) as i128)
    }
    fn accrue_borrow(&mut self, index: usize, at: i64) -> Result<()> {
        let p = &mut self.borrows[index];
        let through = if p.fixed && p.expiry < at {
            p.expiry
        } else {
            at
        };
        p.accrued = p
            .accrued
            .saturating_add(cash_interest(p.principal, p.apr, p.accrued_to, through));
        p.accrued_to = through;
        Ok(())
    }
    /// Settle a cash borrow: voluntary/term repay from vault cash when possible,
    /// otherwise sell the pledge (and take the liquidation bonus when forced).
    fn settle_borrow(&mut self, index: usize, at: i64, spot: u64, liquidate: bool) -> Result<()> {
        self.accrue_borrow(index, at)?;
        let p = self.borrows.remove(index);
        let debt = p.principal.saturating_add(p.accrued);
        if !liquidate && self.balances[V][0] >= debt {
            self.transfer(V, M, 0, debt as i128)?;
            return Ok(());
        }
        let proceeds = mul(p.pledged, spot);
        self.transfer(V, M, 1, p.pledged as i128)?;
        self.transfer(M, V, 0, proceeds as i128)?;
        let bonus = if liquidate {
            ((debt as u128 * BORROW_BONUS) / 1_000_000) as u64
        } else {
            0
        };
        let taken = (debt.saturating_add(bonus)).min(self.balances[V][0]);
        self.transfer(V, M, 0, taken as i128)
    }
    /// Move the clock to `tick` and settle what has come due, as the
    /// off-chain ledger's session advance and live sync do.
    /// A replay advance must move to a later session; a live action's clock
    /// may repeat the last one's instant (two actions in one millisecond).
    fn advance(&mut self, tick: Tick, strict: bool) -> Result<()> {
        let date = tick.date;
        valid((date > self.date || (!strict && date == self.date)) && tick.apr <= 1_000_000)?;
        attested(date, tick.spot)?;
        for o in &tick.closes {
            valid(o.at <= date)?;
            attested(o.at, o.price)?;
        }
        let close = |at: i64| {
            replay(at).or_else(|| tick.closes.iter().find(|o| o.at == at).map(|o| o.price))
        };
        // Due: expired and its close is known. A live close that is not final
        // yet is simply not attested, and the position waits for it.
        let due = |at: i64| at <= date && close(at).is_some();
        let spot = tick.spot;
        self.date = date;
        self.spot = spot;
        let mut deliveries: BTreeMap<i64, (i128, i128)> = BTreeMap::new();
        for p in &self.options {
            if due(p.terms.expiry) {
                let d = p.terms.delivery(if p.terms.dividend {
                    10_000
                } else {
                    close(p.terms.expiry).unwrap()
                });
                let group = deliveries.entry(p.terms.expiry).or_insert((0, 0));
                group.0 += d.0;
                group.1 += d.1;
            }
        }
        self.options.retain(|p| !due(p.terms.expiry));
        for (_, (cash, stock)) in deliveries {
            self.transfer(C, V, 0, cash)?;
            self.transfer(C, V, 1, stock)?;
        }
        while let Some(i) = self.shorts.iter().position(|p| due(p.expiry)) {
            let e = self.shorts[i].expiry;
            self.cover(i, e, close(e).unwrap())?;
        }
        while let Some(i) = self.loans.iter().position(|p| due(p.expiry)) {
            let e = self.loans[i].expiry;
            self.recall(i, e, close(e).unwrap())?;
        }
        if !tick.carry {
            return Ok(());
        }
        // One pass in book order, as the ledger carries each loan: a fixed loan
        // whose close is in settles at it; one past its date without a close
        // waits; the rest accrue, reprice if variable, and are sold up if the
        // pledge no longer covers the debt at the liquidation threshold.
        let mut i = 0;
        while i < self.borrows.len() {
            let (fixed, expiry) = (self.borrows[i].fixed, self.borrows[i].expiry);
            if fixed && due(expiry) {
                self.settle_borrow(i, expiry, close(expiry).unwrap(), false)?;
                continue;
            }
            if fixed && expiry <= date {
                i += 1;
                continue;
            }
            self.accrue_borrow(i, date)?;
            if !fixed && tick.apr > 0 {
                self.borrows[i].apr = tick.apr;
            }
            let p = &self.borrows[i];
            let cover = (mul(p.pledged, spot) as u128 * BORROW_LIQ) / 1_000_000;
            if (p.principal as u128 + p.accrued as u128) > cover {
                self.settle_borrow(i, date, spot, true)?;
            } else {
                i += 1;
            }
        }
        Ok(())
    }
    /// One instruction's work. Live, the off-chain book moves with the wall
    /// clock, so an action carries the clock it happened at: the book is
    /// brought to `tick` first, then the action applies, as one revision.
    pub fn execute(&mut self, tick: Option<Tick>, a: Action) -> Result<()> {
        if let Some(tick) = tick {
            valid(!matches!(a, Action::Advance { .. }))?;
            let original = self.totals();
            self.advance(tick, false)?;
            require!(self.totals() == original, VaultError::Conservation);
        }
        self.apply(a)
    }
    pub fn apply(&mut self, a: Action) -> Result<()> {
        let original = self.totals();
        let spot = self.spot;
        match a {
            Action::Transfer {
                deposit,
                stock,
                amount,
            } => {
                valid(
                    amount > 0
                        && amount
                            <= if stock {
                                1_000_000_000
                            } else {
                                1_000_000_000_000
                            },
                )?;
                self.transfer(
                    if deposit { W } else { V },
                    if deposit { V } else { W },
                    stock as usize,
                    amount as i128,
                )?;
            }
            Action::Stock {
                buy,
                quantity,
                price,
            } => {
                qty(quantity)?;
                // The replay fills at its close. Live, a stock order fills at
                // the bid or ask, which the operator attests within 10% of spot.
                valid(if live(self.date) {
                    price > 0 && price.abs_diff(spot) <= spot / 10
                } else {
                    price == spot
                })?;
                let (from, to) = if buy { (V, M) } else { (M, V) };
                self.transfer(from, to, 0, mul(quantity, price) as i128)?;
                self.transfer(to, from, 1, quantity as i128)?;
            }
            Action::Open { id, terms, premium } => {
                self.unique(&id)?;
                terms.validate(self.date)?;
                valid(premium.unsigned_abs() <= 4_010_000_000_000)?;
                let tail = terms
                    .legs
                    .iter()
                    .filter(|l| l.call)
                    .map(|l| {
                        if l.buy {
                            l.ratio as i32
                        } else {
                            -(l.ratio as i32)
                        }
                    })
                    .sum::<i32>();
                if tail == 0 {
                    let b = sweep(&[&terms], false);
                    valid(premium as i128 >= b[0].min(0) && premium as i128 <= b[1].max(0))?;
                }
                self.transfer(V, C, 0, premium as i128)?;
                self.options.insert(0, OptionPosition { id, terms });
            }
            Action::Close { id, premium } => {
                let i = self
                    .options
                    .iter()
                    .position(|p| p.id == id)
                    .ok_or(error!(VaultError::Position))?;
                self.options.remove(i);
                self.transfer(V, C, 0, premium as i128)?;
            }
            Action::Margin { isolated } => {
                self.isolated = isolated;
            }
            Action::Lend {
                id,
                quantity,
                expiry,
                premium,
            } => {
                qty(quantity)?;
                self.future(expiry)?;
                self.unique(&id)?;
                valid(self.balances[V][1] >= self.reserves()[1] + quantity)?;
                let cap = spot * 3 / 2;
                let interest = interest(quantity, spot, self.date, expiry);
                let total = mul(quantity, cap) + interest;
                valid(self.balances[C][0] >= total + self.reserves()[2])?;
                self.transfer(V, M, 1, quantity as i128)?;
                self.transfer(M, C, 0, mul(quantity, spot) as i128)?;
                self.transfer(C, M, 0, premium as i128)?;
                self.balances[C][0] = self.balances[C][0]
                    .checked_sub(total)
                    .ok_or(error!(VaultError::Balance))?;
                self.loans.insert(
                    0,
                    Loan {
                        id,
                        quantity,
                        opened: self.date,
                        expiry,
                        cap,
                        interest,
                    },
                );
            }
            Action::Recall { id } => {
                let i = self
                    .loans
                    .iter()
                    .position(|p| p.id == id)
                    .ok_or(error!(VaultError::Position))?;
                self.recall(i, self.date, spot)?;
            }
            Action::Short {
                id,
                quantity,
                cap,
                expiry,
                premium,
            } => {
                qty(quantity)?;
                self.future(expiry)?;
                self.unique(&id)?;
                valid(cap > spot && cap <= spot * 2)?;
                self.transfer(C, M, 1, quantity as i128)?;
                self.transfer(M, V, 0, mul(quantity, spot) as i128)?;
                self.transfer(V, C, 0, premium as i128)?;
                self.shorts.insert(
                    0,
                    Short {
                        id,
                        quantity,
                        opened: self.date,
                        expiry,
                        cap,
                        interest: interest(quantity, spot, self.date, expiry),
                    },
                );
            }
            Action::Cover { id } => {
                let i = self
                    .shorts
                    .iter()
                    .position(|p| p.id == id)
                    .ok_or(error!(VaultError::Position))?;
                self.cover(i, self.date, spot)?;
            }
            Action::Advance { tick } => {
                self.advance(tick, true)?;
            }
            Action::Restart => {
                valid(
                    self.options.is_empty()
                        && self.loans.is_empty()
                        && self.shorts.is_empty()
                        && self.borrows.is_empty(),
                )?;
                *self = Self::initial();
            }
            Action::Borrow {
                id,
                pledged,
                principal,
                apr,
                fixed,
                expiry,
            } => {
                qty(pledged)?;
                valid(principal > 0 && principal <= 1_000_000_000_000)?;
                valid(apr > 0 && apr <= 1_000_000)?;
                self.unique(&id)?;
                if fixed {
                    self.future(expiry)?;
                } else {
                    valid(expiry == 0)?;
                }
                valid(self.balances[V][1] >= self.reserves()[1] + pledged)?;
                let limit = ((mul(pledged, spot) as u128 * BORROW_LTV) / 1_000_000) as u64;
                valid(principal <= limit)?;
                valid(self.balances[M][0] >= principal)?;
                self.transfer(M, V, 0, principal as i128)?;
                self.borrows.insert(
                    0,
                    Borrow {
                        id,
                        pledged,
                        principal,
                        apr,
                        fixed,
                        opened: self.date,
                        expiry: if fixed { expiry } else { 0 },
                        accrued: 0,
                        accrued_to: self.date,
                    },
                );
            }
            Action::Repay { id } => {
                let i = self
                    .borrows
                    .iter()
                    .position(|p| p.id == id)
                    .ok_or(error!(VaultError::Position))?;
                self.settle_borrow(i, self.date, spot, false)?;
            }
        }
        // Active risk is deliberately capped for transaction compute/account bounds.
        valid(
            self.options.len() + self.loans.len() + self.shorts.len() + self.borrows.len() <= 64,
        )?;
        require!(self.totals() == original, VaultError::Conservation);
        self.collateral()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// The replay observation at clock index `i`.
    fn at(i: usize) -> i64 {
        REPLAY_EPOCH + HOURS[i] as i64 * HOUR
    }
    fn tick(date: i64, spot: u64, closes: Vec<Observation>) -> Tick {
        Tick {
            date,
            spot,
            closes,
            apr: 0,
            carry: true,
        }
    }
    fn replay_tick(i: usize) -> Tick {
        tick(at(i), PRICES[i], vec![])
    }
    fn spread(q: u64, low: u64, high: u64, sell: bool) -> Terms {
        Terms {
            curve: None,
            quantity: q,
            expiry: at(10),
            physical: false,
            dividend: false,
            legs: vec![
                Leg {
                    call: true,
                    buy: !sell,
                    strike: low,
                    ratio: 1,
                },
                Leg {
                    call: true,
                    buy: sell,
                    strike: high,
                    ratio: 1,
                },
            ],
        }
    }
    #[test]
    fn rejects_zero_payable_and_unfunded_exercise() {
        assert!(spread(1, 140_000_000, 140_000_001, false)
            .validate(REPLAY_EPOCH)
            .is_err());
        let mut b = Book::initial();
        let mut t = spread(1_000_000, 145_000_000, 150_000_000, false);
        t.legs.truncate(1);
        t.physical = true;
        assert!(b
            .apply(Action::Open {
                id: [1; 16],
                terms: t,
                premium: 0
            })
            .is_err());
    }
    #[test]
    fn fractional_cross_cash_never_underreserves() {
        let mut seed = 17u64;
        for _ in 0..100 {
            let mut ts = vec![];
            for _ in 0..6 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                let q = seed % 999_999 + 1;
                ts.push(spread(
                    q,
                    100_000_000 + seed % 12_000_000,
                    140_000_000 + seed % 10_000_000,
                    seed % 3 == 0,
                ));
            }
            let refs: Vec<_> = ts.iter().collect();
            let r = envelope(&refs);
            for i in 0..400 {
                let p = 90_000_000 + i * 170_003;
                let cash = ts.iter().map(|t| t.delivery(p).0).sum::<i128>();
                assert!(cash >= r[0] && cash <= r[1]);
            }
        }
    }
    #[test]
    fn opposed_contracts_net_exactly() {
        let a = spread(333_333, 100_000_001, 150_000_007, false);
        let b = spread(333_333, 100_000_001, 150_000_007, true);
        assert_eq!(envelope(&[&a, &b]), [0; 4]);
    }
    #[test]
    fn cash_borrow_against_pledge_repays_with_interest() {
        let mut b = Book::initial();
        let original = b.totals();
        b.apply(Action::Transfer {
            deposit: true,
            stock: true,
            amount: 2_000_000,
        })
        .unwrap();
        // One share at 142.62 with 60% LTV → 85.572 USDC max. Stay well inside
        // so a session that marks lower still clears the liquidation threshold.
        b.apply(Action::Borrow {
            id: [9; 16],
            pledged: 1_000_000,
            principal: 50_000_000,
            apr: 50_000, // 5%
            fixed: false,
            expiry: 0,
        })
        .unwrap();
        assert_eq!(b.borrows.len(), 1);
        assert_eq!(b.balances[V][0], 50_000_000);
        assert!(b
            .apply(Action::Borrow {
                id: [10; 16],
                pledged: 1_000_000,
                principal: 86_000_000,
                apr: 50_000,
                fixed: false,
                expiry: 0,
            })
            .is_err());
        b.apply(Action::Advance { tick: replay_tick(3) }).unwrap();
        assert_eq!(b.borrows.len(), 1);
        assert!(b.borrows[0].accrued > 0);
        b.apply(Action::Repay { id: [9; 16] }).unwrap();
        assert!(b.borrows.is_empty());
        assert_eq!(b.totals(), original);
    }
    #[test]
    fn productive_loan_and_protected_short_conserve_assets() {
        let mut b = Book::initial();
        let original = b.totals();
        b.apply(Action::Transfer {
            deposit: true,
            stock: true,
            amount: 1_000_000,
        })
        .unwrap();
        b.apply(Action::Transfer {
            deposit: true,
            stock: false,
            amount: 1_000_000_000,
        })
        .unwrap();
        b.apply(Action::Lend {
            id: [1; 16],
            quantity: 333_333,
            expiry: at(10),
            premium: 17,
        })
        .unwrap();
        assert_eq!(b.balances[C][1], 10_000_000_000);
        assert_eq!(b.reserves()[4], 333_333);
        b.apply(Action::Short {
            id: [2; 16],
            quantity: 333_333,
            cap: 160_000_000,
            expiry: at(10),
            premium: 200,
        })
        .unwrap();
        b.apply(Action::Advance { tick: replay_tick(11) }).unwrap();
        assert_eq!(b.totals(), original);
        assert!(b.loans.is_empty() && b.shorts.is_empty());
        b.apply(Action::Restart).unwrap();
        assert_eq!(b, Book::initial());
    }
    #[test]
    fn physical_delivery_matches_strict_strike_boundaries() {
        let mut t = spread(333_333, 100_000_003, 150_000_007, false);
        t.physical = true;
        let bounds = envelope(&[&t]);
        for p in [
            0,
            100_000_002,
            100_000_003,
            100_000_004,
            150_000_006,
            150_000_007,
            150_000_008,
            300_000_000,
        ] {
            let (c, s) = t.delivery(p);
            assert!(c >= bounds[0] && c <= bounds[1] && s >= bounds[2] && s <= bounds[3]);
        }
    }
    #[test]
    fn replay_constants_match_the_table() {
        assert_eq!(REPLAY_HOURS, *HOURS.iter().max().unwrap() as i64);
        assert_eq!(DIVIDEND_DATE, at(32));
        assert_eq!(replay(at(0)), Some(PRICES[0]));
        assert_eq!(replay(at(0) + 1), None);
        assert_eq!(Book::initial().spot, PRICES[0]);
        // A replay advance takes the committed close and nothing else.
        let mut b = Book::initial();
        assert!(b
            .apply(Action::Advance {
                tick: tick(at(3), PRICES[3] + 1, vec![])
            })
            .is_err());
        // An instant inside the replay that is not an observation has no price.
        assert!(b
            .apply(Action::Advance {
                tick: tick(at(3) + 1, PRICES[3], vec![])
            })
            .is_err());
    }
    // 2026-09-25T15:00:00Z and the Friday a week later, 2026-10-02.
    const NOW: i64 = 1_790_348_400_000;
    const FRIDAY: i64 = 1_790_899_200_000;
    fn live_book(spot: u64) -> Book {
        let mut b = Book::initial();
        b.execute(
            Some(tick(NOW, spot, vec![])),
            Action::Transfer {
                deposit: true,
                stock: false,
                amount: 1_000_000_000,
            },
        )
        .unwrap();
        b
    }
    #[test]
    fn live_actions_run_on_the_attested_clock_and_settle_at_the_recorded_close() {
        let original = Book::initial().totals();
        let mut b = live_book(178_190_000);
        assert_eq!((b.date, b.spot), (NOW, 178_190_000));
        // A live expiry need not be a replay observation.
        let mut t = spread(1_000_000, 170_000_000, 190_000_000, false);
        t.expiry = FRIDAY;
        b.execute(
            Some(tick(NOW + 60_000, 178_500_000, vec![])),
            Action::Open {
                id: [7; 16],
                terms: t,
                premium: 9_000_000,
            },
        )
        .unwrap();
        // Past the expiry but with no close attested: the contract waits.
        b.apply(Action::Advance {
            tick: tick(FRIDAY + 3_600_000, 180_000_000, vec![]),
        })
        .unwrap();
        assert_eq!(b.options.len(), 1);
        // The recorded close settles it: 20 wide, close 185 → 15 USDC.
        let vault = b.balances[V][0];
        b.apply(Action::Advance {
            tick: tick(
                FRIDAY + 7_200_000,
                181_000_000,
                vec![Observation {
                    at: FRIDAY,
                    price: 185_000_000,
                }],
            ),
        })
        .unwrap();
        assert!(b.options.is_empty());
        assert_eq!(b.balances[V][0], vault + 15_000_000);
        assert_eq!(b.totals(), original);
    }
    #[test]
    fn live_clock_only_moves_forward_and_prices_stay_bounded() {
        let mut b = live_book(178_190_000);
        let transfer = || Action::Transfer {
            deposit: true,
            stock: false,
            amount: 1,
        };
        // Backwards, a zero price, and a price over the ceiling all fail.
        for bad in [
            tick(NOW - 1, 178_000_000, vec![]),
            tick(NOW + 1, 0, vec![]),
            tick(NOW + 1, MAX_PRICE + 1, vec![]),
            tick(
                NOW + 1,
                178_000_000,
                vec![Observation {
                    at: NOW + 2,
                    price: 1,
                }],
            ),
        ] {
            assert!(b.execute(Some(bad), transfer()).is_err());
        }
        // A nested clock is refused.
        assert!(b
            .execute(
                Some(tick(NOW + 1, 178_000_000, vec![])),
                Action::Advance {
                    tick: tick(NOW + 2, 178_000_000, vec![])
                },
            )
            .is_err());
        // Live stock fills within 10% of the attested spot.
        let buy = |price| Action::Stock {
            buy: true,
            quantity: 1_000_000,
            price,
        };
        assert!(b.clone().apply(buy(200_000_000)).is_err());
        let vault = b.balances[V][0];
        b.apply(buy(178_300_000)).unwrap();
        assert_eq!(b.balances[V][0], vault - 178_300_000);
        // On the replay a stock order fills at the close only.
        let mut r = Book::initial();
        r.apply(Action::Transfer {
            deposit: true,
            stock: false,
            amount: 1_000_000_000,
        })
        .unwrap();
        assert!(r.clone().apply(buy(PRICES[0] + 1)).is_err());
        r.apply(buy(PRICES[0])).unwrap();
    }
    #[test]
    fn live_stock_loan_prices_off_the_attested_spot() {
        let mut b = live_book(178_190_001);
        b.apply(Action::Transfer {
            deposit: true,
            stock: true,
            amount: 1_000_000,
        })
        .unwrap();
        b.apply(Action::Lend {
            id: [3; 16],
            quantity: 1_000_000,
            expiry: FRIDAY,
            premium: 100,
        })
        .unwrap();
        // Floor of 1.5 × spot, which the ledger computes the same way.
        assert_eq!(b.loans[0].cap, 267_285_001);
        // 3.5% for 6d 9h on 178.190001.
        assert_eq!(
            b.loans[0].interest,
            interest(1_000_000, 178_190_001, NOW, FRIDAY)
        );
    }
    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }
    /// A run of the server's chain mode (tests/vault-chain-live.test.ts,
    /// regenerated with PARCEL_CHAIN_FIXTURES=programs/parcel/fixtures): each
    /// line is the book it verified, the instruction's `tick` and `action`
    /// arguments, and the book it projected. The program must compute that
    /// book from them, byte for byte.
    fn replays(fixture: &str, live: bool) {
        let lines: Vec<_> = fixture.lines().collect();
        assert!(lines.len() >= 8);
        let mut previous: Option<Vec<u8>> = None;
        for (n, line) in lines.iter().enumerate() {
            let parts: Vec<_> = line.split(' ').map(hex).collect();
            let (before, args, after) = (&parts[0], &parts[1], &parts[2]);
            if n == 0 {
                assert_eq!(before, &Book::initial().try_to_vec().unwrap());
            }
            if let Some(p) = &previous {
                assert_eq!(p, before);
            }
            let mut book = Book::try_from_slice(before).unwrap();
            let mut rest = &args[..];
            let tick = <Option<Tick> as AnchorDeserialize>::deserialize(&mut rest).unwrap();
            let action = Action::deserialize(&mut rest).unwrap();
            assert!(rest.is_empty(), "line {n}: trailing argument bytes");
            assert_eq!(tick.is_some(), live, "line {n}: only a live action carries a clock");
            book.execute(tick, action)
                .unwrap_or_else(|e| panic!("line {n}: {e:?}"));
            assert_eq!(&book.try_to_vec().unwrap(), after, "line {n}");
            previous = Some(after.clone());
        }
    }
    #[test]
    fn executes_the_servers_live_projection_byte_for_byte() {
        replays(include_str!("../fixtures/live-chain.hex"), true);
    }
    #[test]
    fn executes_the_servers_replay_projection_byte_for_byte() {
        replays(include_str!("../fixtures/replay-chain.hex"), false);
    }
}
