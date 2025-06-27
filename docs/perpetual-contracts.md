# Perpetual Contract Specifications

## Overview

Perpetual contracts are the backbone of modern crypto derivatives exchanges. Unlike traditional futures contracts that have expiration dates, perpetual contracts can be held indefinitely as long as the trader maintains sufficient margin.

## Key Characteristics

### No Expiration Date
- Contracts never expire automatically
- Traders can hold positions indefinitely
- No need to roll over positions

### Funding Rate Mechanism
- Periodic payments between long and short positions
- Keeps perpetual price close to underlying asset price
- Typically occurs every 8 hours (00:00, 08:00, 16:00 UTC)

### Leverage
- Traders can control large positions with small capital
- Leverage ranges from 1x to 125x (varies by exchange)
- Higher leverage = higher risk

## Contract Specifications

### Standard Parameters
```
Contract Size: 1 BTC (or underlying asset unit)
Tick Size: 0.1 USD (minimum price movement)
Lot Size: 0.001 BTC (minimum trade size)
Max Leverage: 125x
Funding Interval: 8 hours
```

### Price Precision
- **Index Price**: 2 decimal places (e.g., 45,000.00)
- **Mark Price**: 2 decimal places (e.g., 45,000.00)
- **Funding Rate**: 4 decimal places (e.g., 0.0001)

## Position Types

### Long Position
- Profit when price increases
- Loss when price decreases
- Pays funding when rate is positive
- Receives funding when rate is negative

### Short Position
- Profit when price decreases
- Loss when price increases
- Receives funding when rate is positive
- Pays funding when rate is negative

## Margin Requirements

### Initial Margin
- Minimum collateral required to open position
- Typically 1-5% of position value
- Higher for higher leverage

### Maintenance Margin
- Minimum collateral to keep position open
- Usually 0.5-2% of position value
- Position liquidated if margin falls below this level

## Example Calculation

```
Position: Long 1 BTC at $45,000
Leverage: 10x
Initial Margin: $4,500 (10% of position value)
Maintenance Margin: $900 (2% of position value)

If BTC price drops to $40,500:
- Unrealized PnL: -$4,500
- Remaining Margin: $0
- Position liquidated (below maintenance margin)
```

## Risk Management

### Position Limits
- Maximum position size per user
- Maximum leverage per user
- Maximum open interest per contract

### Circuit Breakers
- Trading halts during extreme volatility
- Automatic position closures
- Emergency liquidations

## Implementation Considerations

### Order Types
- Market orders
- Limit orders
- Stop-loss orders
- Take-profit orders
- Post-only orders

### Fee Structure
- Maker fees: 0.02-0.05%
- Taker fees: 0.05-0.10%
- Funding rate fees
- Liquidation fees

### Settlement
- Continuous settlement (no physical delivery)
- Cash-settled in quote currency
- Real-time PnL calculation 