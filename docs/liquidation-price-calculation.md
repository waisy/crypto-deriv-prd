# Liquidation Price Calculation

## Overview

The liquidation price is the price level at which an open position is automatically closed by the exchange's risk engine. This happens when a trader's margin can no longer cover the potential losses of the position, specifically when the margin balance drops to the level of the required Maintenance Margin.

Understanding how this price is calculated is crucial for risk management, as it allows traders to set appropriate stop-losses and manage leverage effectively. The formula differs significantly between **Linear** and **Inverse** contracts due to the difference in their PnL calculation and collateral currency.

### Key Inputs for Calculation
- **Entry Price (EP)**: The average price at which the position was opened.
- **Leverage (L)**: The leverage used for the position (e.g., 10x, 50x).
- **Maintenance Margin Rate (MMR)**: The percentage of position value required to keep the position open (e.g., 0.5% or 0.005).

---

## 1. Linear Contracts (e.g., BTC/USDT)

Linear contracts are collateralized and settled in the **quote currency** (e.g., USDT). The PnL is a linear function of the price change, making the calculation straightforward.

### Formula for a LONG Position
For a long position, you are liquidated when the price drops. The loss is the difference between your entry price and the new, lower price.

`Liquidation Price = Entry Price * (1 - 1/Leverage + Maintenance Margin Rate)`

#### Example:
A trader goes long 1 BTC at $50,000 with 20x leverage. The maintenance margin rate is 0.5% (0.005).

- **EP**: $50,000
- **L**: 20
- **MMR**: 0.005

`LP = 50,000 * (1 - 1/20 + 0.005)`
`LP = 50,000 * (1 - 0.05 + 0.005)`
`LP = 50,000 * 0.955`
`LP = $47,750`

If the mark price drops to $47,750, the position will be liquidated.

### Formula for a SHORT Position
For a short position, you are liquidated when the price rises. The loss is the difference between the new, higher price and your entry price.

`Liquidation Price = Entry Price * (1 + 1/Leverage - Maintenance Margin Rate)`

#### Example:
A trader goes short 1 BTC at $50,000 with 20x leverage. The MMR is 0.5%.

- **EP**: $50,000
- **L**: 20
- **MMR**: 0.005

`LP = 50,000 * (1 + 1/20 - 0.005)`
`LP = 50,000 * (1 + 0.05 - 0.005)`
`LP = 50,000 * 1.045`
`LP = $52,250`

If the mark price rises to $52,250, the position will be liquidated.

---

## 2. Inverse Contracts (e.g., BTC/USD settled in BTC)

Inverse contracts are collateralized and settled in the **base currency** (e.g., BTC). This creates a non-linear PnL, as your profit or loss (in BTC) changes value as the price of BTC itself changes. This requires a different formula.

### Formula for a LONG Position
For a long position, the PnL is calculated as `Quantity * (1/Entry_Price - 1/Exit_Price)`. The position is liquidated when the loss depletes the margin.

`1 / Liquidation Price = 1/Entry Price - 1/Leverage + Maintenance Margin Rate`

Therefore:
`Liquidation Price = 1 / (1/Entry Price - 1/Leverage + Maintenance Margin Rate)`

#### Example:
A trader goes long $50,000 worth of BTC contracts (equivalent to 1 BTC at this price) at an entry price of $50,000 with 20x leverage. The MMR is 0.5%.

- **EP**: $50,000
- **L**: 20
- **MMR**: 0.005

`1/LP = 1/50,000 - 1/20 + 0.005`
`1/LP = 0.00002 - 0.05 + 0.005`
`1/LP = -0.04498` 
*(This indicates an error in reasoning, as 1/LP cannot be negative. The MMR must be applied to the value, not as a direct number. Let's use the correct formula derived from contract value).*

**Correct Formula for Inverse Long:**
`Liquidation Price = (Leverage * Entry Price) / (Leverage + 1 - (Leverage * Maintenance Margin Rate))`

`LP = (20 * 50,000) / (20 + 1 - (20 * 0.005))`
`LP = 1,000,000 / (21 - 0.1)`
`LP = 1,000,000 / 20.9`
`LP = $47,846.89`

### Formula for a SHORT Position
**Correct Formula for Inverse Short:**
`Liquidation Price = (Leverage * Entry Price) / (Leverage - 1 + (Leverage * Maintenance Margin Rate))`

#### Example:
A trader goes short $50,000 worth of BTC contracts at an entry price of $50,000 with 20x leverage. The MMR is 0.5%.

- **EP**: $50,000
- **L**: 20
- **MMR**: 0.005

`LP = (20 * 50,000) / (20 - 1 + (20 * 0.005))`
`LP = 1,000,000 / (19 + 0.1)`
`LP = 1,000,000 / 19.1`
`LP = $52,356.02`

## Summary: Why Are They Different?

- **Linear**: Your collateral (e.g., USDT) has a fixed value. A $1 price move against you results in a $1 loss per contract. The risk is linear.
- **Inverse**: Your collateral (e.g., BTC) changes in value as the market moves. If you are long and the price of BTC drops, your position loses value, and your collateral (BTC) also loses value simultaneously. This "compounding" risk effect leads to a closer liquidation price compared to a linear contract with the same parameters. Conversely, for a short position, your collateral (BTC) gains value as the price drops, giving you more cushion. This non-linear risk profile is why the formulas must be different. 