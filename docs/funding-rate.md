# Funding Rate Mechanism

> **Status**: 🤖 AI Generated (Unreviewed) | **Last Updated**: 2025-03-09 | **Needs**: External validation, manual review

## Overview

The funding rate is a periodic payment between long and short positions that keeps the perpetual contract price close to the underlying asset's spot price. This mechanism prevents the perpetual price from deviating too far from the index price.

## How Funding Works

### Basic Concept
- **Positive Funding Rate**: Longs pay shorts
- **Negative Funding Rate**: Shorts pay longs
- **Zero Funding Rate**: No payments

### Funding Intervals
- **Standard**: Every 8 hours (00:00, 08:00, 16:00 UTC)
- **High Volatility**: Can be reduced to 1-4 hours
- **Low Volatility**: Can be extended to 12-24 hours

## Funding Rate Calculation

### Formula
```
Funding Rate = Premium Index + Clamp(Interest Rate - Premium Index, -0.75%, 0.75%)

Where:
- Premium Index = (Max(0, Impact Bid Price - Impact Ask Price) - Max(0, Impact Ask Price - Impact Bid Price)) / Impact Mid Price
- Impact Bid/Ask = Average of top 10 bids/asks weighted by size
- Interest Rate = 0.01% (typically fixed)
```

### Simplified Example
```
Current Price: $45,000
Index Price: $44,800
Premium: $200

Premium Index = $200 / $44,800 = 0.00446 (0.446%)
Interest Rate = 0.01%

Funding Rate = 0.446% + 0.01% = 0.456%
```

## Impact on Positions

### Long Position Example
```
Position: Long 1 BTC
Funding Rate: 0.456% (positive)
Funding Payment: -$205.20 (pays to shorts)
Calculation: 1 BTC × $45,000 × 0.456% = $205.20
```

### Short Position Example
```
Position: Short 1 BTC
Funding Rate: 0.456% (positive)
Funding Payment: +$205.20 (receives from longs)
Calculation: 1 BTC × $45,000 × 0.456% = $205.20
```

## Funding Rate Scenarios

### High Premium (Longs Pay Shorts)
- Perpetual price > Index price
- Market expects price to rise
- Longs pay funding to shorts
- Encourages short positions

### Low Premium (Shorts Pay Longs)
- Perpetual price < Index price
- Market expects price to fall
- Shorts pay funding to longs
- Encourages long positions

### Neutral Premium
- Perpetual price ≈ Index price
- Minimal funding payments
- Market in equilibrium

## Implementation Details

### Funding Collection
- Automatic deduction from margin
- Real-time calculation
- Historical funding rates stored
- Predictable payment times

### Funding Distribution
- Proportional to position size
- Applied to all open positions
- No minimum position size
- Immediate effect on PnL

### Rate Limits
- **Maximum Rate**: ±0.75% per 8-hour period
- **Emergency Rate**: ±1.5% during extreme volatility
- **Minimum Rate**: ±0.01% (interest rate floor)

## Risk Management

### Funding Rate Manipulation
- Large positions can influence funding
- Circuit breakers during manipulation
- Position limits to prevent abuse
- Real-time monitoring

### Extreme Scenarios
- **High Volatility**: Increased funding frequency
- **Low Liquidity**: Adjusted impact calculation
- **Market Halts**: Funding rate freeze
- **Emergency**: Manual rate adjustment

## Example Scenarios

### Scenario 1: Bull Market
```
Index Price: $45,000
Perpetual Price: $46,000
Premium: $1,000
Funding Rate: 2.22% (capped at 0.75%)
Result: Longs pay shorts 0.75%
```

### Scenario 2: Bear Market
```
Index Price: $45,000
Perpetual Price: $44,000
Premium: -$1,000
Funding Rate: -2.22% (capped at -0.75%)
Result: Shorts pay longs 0.75%
```

### Scenario 3: Sideways Market
```
Index Price: $45,000
Perpetual Price: $45,050
Premium: $50
Funding Rate: 0.11%
Result: Longs pay shorts 0.11%
```

## Best Practices

### For Traders
- Monitor funding rates before opening positions
- Consider funding costs in position sizing
- Close positions before funding if profitable
- Use funding rate as market sentiment indicator

### For Exchanges
- Transparent funding rate calculation
- Real-time funding rate display
- Historical funding rate data
- Clear funding payment schedule 