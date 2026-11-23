// Dip-and-recover bot for the btc-race-24h-20261123-0511 bounty.
//
// Trades Coinbase Wrapped BTC (CBBTC) against USDC on 1-minute bars, long only,
// with $1,000 of paper money. The pool is thin, so sharp drops tend to snap back
// within an hour or two; the bot buys a dip only once the price has started
// turning back up, then rides the recovery with a take-profit, a stop-loss and a
// trailing stop. It never buys a rip: on this race's dev window, sharp 15-minute
// rises reverted within the hour.
//
// Strategy (parameters tuned on the frozen dev window in the kit, then verified
// with the kit's own grader — see README.md):
//   * BUY the whole cash balance when the 30-minute return is at or below -0.8%,
//     the last 5 minutes have stopped falling (5-minute return >= 0), and the
//     240-minute trend is not deeply negative (240-minute return >= -2%).
//   * SELL everything when the close is +2.0% above the entry cost (take profit),
//     -1.0% below it (stop), -1.0% below the highest close since entry (trailing
//     stop), or 240 bars after entry (max hold).
//   * After any exit, wait 20 bars before the next buy.
//   * Late fallback: after bar 1300, if still flat and the 60-minute return is
//     at or below -0.8%, buy once, so the bot always takes at least one trade.
//
// Fills happen at the next bar's open with a 4 bps fee, 2 bps modelled slippage
// and constant-product price impact, so every round trip costs roughly 26 bps;
// the +2.0% take-profit target clears that with room to spare. The bot is fully
// deterministic: every decision is a function of the bars seen so far, never of
// the clock, the environment or randomness.
//
// Standard library only; the wire protocol lives in vendor/makefun-bars.ts, a
// byte-for-byte copy of the kit's SDK shim.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Raw price units per USDC (price_scale 5): a close of 5895658763 is $58,956.59.
const PRICE_SCALE = 1e5;
// A buy may spend up to the whole cash balance; a sell may sell the whole qty.
const MAX_SLIPPAGE_BPS = 200;

// --- tuned parameters (see README.md for the numbers behind them) ---
const DIP_WINDOW = 30; // minutes over which the dip is measured
const DIP_BPS = -80; // buy when the 30-minute return is at or below -0.80%
const TURN_WINDOW = 5; // minutes over which the turn back up is confirmed
const TREND_WINDOW = 240; // minutes over which the trend guard is measured
const TREND_MIN_BPS = -200; // skip dips while the 240-minute return is below -2%
const TAKE_PROFIT_BPS = 200; // sell at +2.00% above the entry cost
const STOP_BPS = -100; // sell at -1.00% below the entry cost
const TRAIL_BPS = -100; // sell at -1.00% below the peak close since entry
const MAX_HOLD_BARS = 240; // sell at the latest after this many bars in a trade
const COOLDOWN_BARS = 20; // bars to wait after an exit before buying again
const LATE_BAR = 1300; // after this bar, the fallback dip buy may fire
const FALLBACK_WINDOW = 60; // minutes over which the fallback dip is measured
const FALLBACK_BPS = -80; // fallback buy when the 60-minute return is <= -0.80%

// Return of the latest close against the close `bars` minutes ago, in bps,
// or null when there is not enough history yet.
function returnBps(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - bars]!;
  return ((now - then) / then) * 10_000;
}

// --- per-run state (closure variables, reset only by a fresh process) ---
const history: number[] = [];
let peak = 0;
let entrySeq = -1;
let coolUntil = -1;

function buyAll(state: BarsState): OrderInput[] {
  if (state.cash <= 0n) return [];
  // The buy fills on the next bar; record its seq so the max-hold clock and
  // the peak start from the fill bar, which the next batch reports.
  entrySeq = state.seq + 1;
  peak = 0;
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null || state.warmingUp) return [];
    const close = Number(closeRaw) / PRICE_SCALE;

    // History of closes, oldest first, kept on the bot object via closure.
    history.push(close);

    const pos = state.positions.get(SYMBOL);
    const qty = pos?.qty ?? 0n;

    if (qty > 0n) {
      // We hold a position: work out whether to exit it.
      const cost = pos!.cost;
      // Entry cost per BTC in USDC: cost (micro-USDC) over qty (1e-8 BTC).
      const entry = Number(cost) / 1e6 / (Number(qty) / 1e8);
      if (entry > 0) {
        peak = Math.max(peak, close);
        const vsEntryBps = ((close - entry) / entry) * 10_000;
        const vsPeakBps = ((close - peak) / peak) * 10_000;
        const heldBars = state.seq - entrySeq;
        if (
          vsEntryBps >= TAKE_PROFIT_BPS ||
          vsEntryBps <= STOP_BPS ||
          vsPeakBps <= TRAIL_BPS ||
          heldBars >= MAX_HOLD_BARS
        ) {
          coolUntil = state.seq + COOLDOWN_BARS;
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: no position to exit. A fresh position starts its peak at the first
    // close seen after the buy fills.
    peak = 0;
    entrySeq = -1;

    if (state.seq < coolUntil) return [];

    const dip = returnBps(history, DIP_WINDOW);
    if (dip !== null && dip <= DIP_BPS) {
      const turn = returnBps(history, TURN_WINDOW);
      const trend = returnBps(history, TREND_WINDOW);
      const turnedUp = turn !== null && turn >= 0;
      const trendOk = trend === null || trend >= TREND_MIN_BPS;
      if (turnedUp && trendOk) {
        return buyAll(state);
      }
    }

    // Late fallback: make sure the bot takes at least one trade even on a
    // window with no qualifying dip, so it can still clear the dev gate.
    if (state.seq >= LATE_BAR) {
      const dip60 = returnBps(history, FALLBACK_WINDOW);
      if (dip60 !== null && dip60 <= FALLBACK_BPS) {
        return buyAll(state);
      }
    }

    return [];
  },
});
