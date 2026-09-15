use crate::VaultError;
use anchor_lang::prelude::*;
const F: u128 = 1_000_000_000_000;
// Exact exp_fixed(4 * F) - F, avoiding the same 32 divisions per settlement.
const EXP_RANGE: u128 = 53598150033128;
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Curve {
    pub exponential: bool,
    pub buy: bool,
    pub up: bool,
    pub lower: u64,
    pub upper: u64,
    pub cap: u64,
}
fn exp_fixed(x: u128) -> u128 {
    let (mut term, mut sum) = (F, F);
    for n in 1..=32 {
        term = term * x / (F * n);
        sum += term;
        if term == 0 {
            break;
        }
    }
    sum
}
impl Curve {
    fn maximum(&self, q: u64) -> u128 {
        q as u128 * self.cap as u128 / 1_000_000
    }
    pub fn validate(&self, q: u64, dividend: bool) -> Result<()> {
        require!(
            self.lower < self.upper
                && self.upper <= 10_000_000_000
                && self.cap > 0
                && self.cap <= 10_000_000_000
                && (!dividend || self.upper <= 100_000)
                && self.maximum(q) > 0,
            VaultError::InvalidTerms
        );
        Ok(())
    }
    pub fn payoff(&self, q: u64, price: u64) -> i128 {
        let clipped = price.clamp(self.lower, self.upper);
        if clipped == if self.up { self.lower } else { self.upper } {
            return 0;
        }
        if clipped == if self.up { self.upper } else { self.lower } {
            return self.maximum(q) as i128 * if self.buy { 1 } else { -1 };
        }
        let distance = if self.up {
            clipped - self.lower
        } else {
            self.upper - clipped
        };
        let x = distance as u128 * F / (self.upper - self.lower) as u128;
        let fraction = if self.exponential {
            (exp_fixed(4 * x) - F) * F / EXP_RANGE
        } else {
            x * x / F
        };
        (self.maximum(q) * fraction / F) as i128 * if self.buy { 1 } else { -1 }
    }
    pub fn bounds(&self, q: u64) -> [i128; 4] {
        let cap = self.maximum(q) as i128;
        [
            if self.buy { 0 } else { -cap },
            if self.buy { cap } else { 0 },
            0,
            0,
        ]
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn denominator_matches_protocol_series() {
        assert_eq!(EXP_RANGE, exp_fixed(4 * F) - F);
    }
    #[test]
    fn capped_monotone_curves_and_inverse_rounding() {
        for exponential in [false, true] {
            for up in [false, true] {
                let c = Curve {
                    exponential,
                    buy: true,
                    up,
                    lower: 130_000_000,
                    upper: 160_000_000,
                    cap: 10_000_000,
                };
                c.validate(333_333, false).unwrap();
                let mut previous = c.payoff(333_333, 0);
                for p in (0..200_000_000).step_by(123_457) {
                    let value = c.payoff(333_333, p);
                    assert!(value >= 0 && value <= 3_333_330);
                    assert!(if up {
                        value >= previous
                    } else {
                        value <= previous
                    });
                    assert_eq!(
                        value,
                        -Curve {
                            buy: false,
                            ..c.clone()
                        }
                        .payoff(333_333, p)
                    );
                    previous = value;
                }
                assert_eq!(
                    c.payoff(333_333, if up { 160_000_000 } else { 130_000_000 }),
                    3_333_330
                );
            }
        }
    }
}
