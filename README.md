# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/brendley224der/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/brendley224der/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A dip-and-recover trading bot for Coinbase Wrapped BTC (cbBTC) against USDC. It buys a sharp 30-minute dip only once the price has started turning back up, then rides the recovery with a take-profit, a stop-loss and a trailing stop. It never buys rips: on this race's dev window, sharp 15-minute rises reverted within the hour. Simulation only — no real money ever moves.

## Run it

Requires Node 22 or later. No dependencies, nothing to install.

```sh
node main.ts
```

`main.ts` is the bot: it reads one JSON line per minute (a 1-minute cbBTC bar) on stdin and answers buy/sell orders on stdout, following the agent-fun/bars-replay/v1 protocol via the vendored `vendor/makefun-bars.ts` SDK shim. Grade it on the frozen dev window with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## Strategy

- **Buy** the whole cash balance when the 30-minute return is at or below −0.8%, the last 5 minutes have stopped falling (5-minute return ≥ 0), and the 240-minute trend is not deeply negative (≥ −2%).
- **Sell** everything at +2.0% above the entry cost, −1.0% below it, −1.0% below the highest close since entry, or 240 bars after entry, whichever comes first.
- **Cooldown** 20 bars after any exit before the next buy.
- **Late fallback:** after bar 1300, if still flat and the 60-minute return is at or below −0.8%, buy once, so the bot always takes at least one trade.

A full-size round trip costs about 26 bps in fees, slippage and price impact, so the +2.0% take-profit target clears that with room to spare.

## Dev grade

On this race's frozen 24-hour dev window (kit's own grader, two executions, byte-for-byte replay): **net PnL +26.33 USDC**, 5 trades, win rate 0.67, max drawdown 0.59%, fees 2.45 USDC, 0 rejected orders, guardrails met. At 2× fees the net PnL is still +23.88 USDC. Buy-and-hold on the same window made +32.17 USDC but would lose −38.39 USDC on the time-reversed (falling) window, where this bot loses −27.29 USDC — the stops and the turn-up filter cut the downtrend bleeding.

---

Entered on [make.fun](https://make.fun/?ref=amsc6jjj&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards
