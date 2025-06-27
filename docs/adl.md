# Auto-Deleveraging (ADL)

## Overview

Auto-Deleveraging (ADL) is a final risk management mechanism that is activated only when the exchange's Insurance Fund is insufficient to cover the losses from a bankrupt position. It is a process where the exchange automatically closes out profitable opposing positions to cover the shortfall, preventing a system-wide "socialized loss" scenario.

**ADL is a mechanism of last resort, not a standard operational procedure.**

## Why is ADL Necessary?

In a highly volatile market, a large position can be liquidated at a price worse than its bankruptcy price. This results in a contract loss that the trader's margin cannot cover.

1.  **Standard Process**: The exchange's Insurance Fund steps in to absorb this contract loss.
2.  **Emergency Scenario**: If the liquidation is very large or the market moves too quickly, the contract loss might be bigger than the entire Insurance Fund.
3.  **The Problem**: The exchange now has a deficit. The profitable traders on the other side of the trade have unrealized gains that, in this extreme scenario, cannot be fully paid out by the system.
4.  **The Solution (ADL)**: To resolve the deficit and ensure the system remains solvent, the exchange forces the most profitable opposing traders to "delever" (i.e., close a portion of their position) at the bankrupt position's price.

ADL is the alternative to a "clawback" or "socialized loss," where the losses would be spread across all traders or all profitable traders, which is generally considered less fair.

## How the ADL Process Works

1.  **Trigger**: A liquidation order cannot be filled, and the Insurance Fund is depleted or insufficient to cover the remaining loss.
2.  **Ranking**: All traders with profitable positions on the opposite side of the bankrupt position are ranked. The highest-ranked traders are prioritized for deleveraging.
3.  **Selection**: The system selects the highest-ranked trader(s) with enough position size to cover the bankrupt position's remaining contracts.
4.  **Execution**: The selected trader's profitable position is automatically closed at the original position's bankruptcy price (not the current market price). The bankrupt position is simultaneously closed.
5.  **Notification**: The deleveraged trader is immediately notified that a portion of their position has been closed via ADL.

## The ADL Ranking System

The core of the ADL system is its ranking queue. Traders with the most profitable and highly-leveraged positions are considered highest-risk and are therefore at the front of the queue to be deleveraged.

### Calculation
The ranking is typically calculated based on a score derived from profit and leverage:

`ADL Score = Unrealized Profit Percentage * Effective Leverage`

Where:
- `Unrealized Profit Percentage = Unrealized PnL / Absolute Position Value`
- `Effective Leverage = Absolute Position Value / (Total Wallet Balance + Unrealized PnL)`

A higher score means a higher position in the ADL queue.

### The ADL Indicator
To provide transparency, exchanges display an **ADL indicator** for each user's position, often shown as a series of 1 to 5 lights or bars.

- **(  düşük ) [][][][] ( yüksek )**: All lights off, lowest priority.
- **( düşük ) [■][][][] ( yüksek )**: One light on, low priority.
- **( düşük ) [■][■][■][■][■] ( yüksek )**: All five lights on, highest priority. You are at high risk of being deleveraged if a major liquidation event occurs.

This indicator represents your position in the queue. If all five lights are lit, it means your position is in the top percentile of profitability and leverage, and you will be among the first to be selected if ADL is triggered.

## Example Scenario

1.  **The Market**: BTC price is crashing rapidly.
2.  **Bankrupt Trader**: A whale, "Trader Long," has a massive long position that gets liquidated. The market gaps down so fast that after the position is closed, there is a $2 million loss that exceeds the remaining $1.5 million in the Insurance Fund. The deficit is $500,000.
3.  **Profitable Traders**: On the other side, "Trader Short A" and "Trader Short B" have highly profitable short positions.
4.  **ADL Ranking**: Trader Short A has a higher ADL score (more profit/leverage) than Trader Short B.
5.  **ADL Execution**: The system needs to close $500,000 worth of profitable short positions. It targets Trader Short A first. A portion of Trader Short A's position is automatically closed at Trader Long's bankruptcy price. The system is now solvent again.
6.  **Outcome**: Trader Short A had a portion of their profitable position closed, forgoing potential future profits but keeping the realized gains up to that point. The entire system avoided a catastrophic failure.

## How to Minimize Your ADL Risk

- **Monitor Your ADL Indicator**: This is the most direct way to assess your risk. If the lights start turning on, you are moving up in the queue.
- **Reduce Leverage**: Lowering your leverage is the most effective way to reduce your ADL score and your position in the queue.
- **Realize Profits**: Partially closing a highly profitable position to "take profits off the table" will reduce your unrealized PnL and thus lower your ADL ranking.

ADL is a rare but necessary evil in derivatives markets. While it can be frustrating for profitable traders, it is a critical safety net that protects the integrity of the entire trading system. 