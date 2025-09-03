# Bankruptcy Price

> **Status**: 🤖 AI Generated (Unreviewed) | **Last Updated**: 2025-03-09 | **Needs**: External validation, manual review

## Overview

The bankruptcy price is the price level at which a trader's position losses exactly equal their total margin, leaving zero remaining balance. Understanding this concept is crucial for risk management and liquidation mechanics.

## Bankruptcy Price Definition

### Core Concept
The bankruptcy price represents the worst-case scenario where a trader loses their entire margin but no more. Beyond this price, the exchange would incur losses.

### Mathematical Definition
```
Bankruptcy Price = Entry Price ± (Entry Price / Leverage)

Where:
- "+" for short positions (price rises)
- "-" for long positions (price falls)
```

## Long Position Bankruptcy

### Formula
```
Long Bankruptcy Price = Entry Price × (1 - 1/Leverage)
```

### Example Calculations
```
Example 1: 10x Leverage
Entry: $45,000
Bankruptcy Price = $45,000 × (1 - 1/10)
Bankruptcy Price = $45,000 × 0.9
Bankruptcy Price = $40,500

Example 2: 50x Leverage
Entry: $45,000
Bankruptcy Price = $45,000 × (1 - 1/50)
Bankruptcy Price = $45,000 × 0.98
Bankruptcy Price = $44,100

Example 3: 100x Leverage
Entry: $45,000
Bankruptcy Price = $45,000 × (1 - 1/100)
Bankruptcy Price = $45,000 × 0.99
Bankruptcy Price = $44,550
```

### Risk Analysis
| Leverage | Price Drop to Bankruptcy | Risk Level |
|----------|-------------------------|------------|
| 1x       | 100%                    | Very Low   |
| 5x       | 20%                     | Low        |
| 10x      | 10%                     | Medium     |
| 25x      | 4%                      | High       |
| 50x      | 2%                      | Very High  |
| 100x     | 1%                      | Extreme    |

## Short Position Bankruptcy

### Formula
```
Short Bankruptcy Price = Entry Price × (1 + 1/Leverage)
```

### Example Calculations
```
Example 1: 10x Leverage
Entry: $45,000
Bankruptcy Price = $45,000 × (1 + 1/10)
Bankruptcy Price = $45,000 × 1.1
Bankruptcy Price = $49,500

Example 2: 50x Leverage
Entry: $45,000
Bankruptcy Price = $45,000 × (1 + 1/50)
Bankruptcy Price = $45,000 × 1.02
Bankruptcy Price = $45,900

Example 3: 100x Leverage
Entry: $45,000
Bankruptcy Price = $45,000 × (1 + 1/100)
Bankruptcy Price = $45,000 × 1.01
Bankruptcy Price = $45,450
```

## Bankruptcy vs Liquidation Price

### Key Differences
| Aspect | Bankruptcy Price | Liquidation Price |
|--------|------------------|-------------------|
| **Definition** | Zero remaining margin | Maintenance margin level |
| **Timing** | After liquidation | Before liquidation |
| **Loss** | 100% of margin | Partial margin loss |
| **Exchange Risk** | Exchange may lose | Exchange protected |

### Price Relationship
```
Liquidation Price = Bankruptcy Price ± Maintenance Margin Buffer

For Long Positions:
Liquidation Price = Bankruptcy Price + (Entry Price × Maintenance Margin Rate)

For Short Positions:
Liquidation Price = Bankruptcy Price - (Entry Price × Maintenance Margin Rate)
```

### Example Comparison
```
Position: Long 1 BTC at $45,000, 10x leverage
Maintenance Margin: 2%

Bankruptcy Price = $45,000 × (1 - 1/10) = $40,500
Liquidation Price = $40,500 + ($45,000 × 0.02) = $41,400

Buffer = $41,400 - $40,500 = $900 (2% of position value)
```

## Bankruptcy Scenarios

### Scenario 1: Gradual Price Movement
```
Initial Position: Long 1 BTC at $45,000, 10x leverage
Initial Margin: $4,500
Bankruptcy Price: $40,500

Price drops to $42,000:
- Unrealized PnL: -$3,000
- Remaining Margin: $1,500
- Status: Safe

Price drops to $40,500:
- Unrealized PnL: -$4,500
- Remaining Margin: $0
- Status: Bankruptcy (but liquidation occurred earlier)
```

### Scenario 2: Gap Down (Bankruptcy)
```
Initial Position: Long 1 BTC at $45,000, 10x leverage
Initial Margin: $4,500
Bankruptcy Price: $40,500

Overnight gap to $39,000:
- Unrealized PnL: -$6,000
- Remaining Margin: -$1,500
- Status: Bankruptcy exceeded
- Exchange loss: $1,500
```

## Insurance Fund Impact

### When Bankruptcy is Exceeded
- **Exchange Loss**: Difference between liquidation price and bankruptcy price
- **Insurance Fund**: Covers the exchange loss
- **Trader Loss**: Limited to their margin
- **Market Impact**: Additional slippage costs

### Example Calculation
```
Position: Long 1 BTC at $45,000, 10x leverage
Liquidation Price: $41,400
Bankruptcy Price: $40,500
Actual Liquidation: $39,000

Exchange Loss = Bankruptcy Price - Actual Liquidation
Exchange Loss = $40,500 - $39,000 = $1,500

Insurance Fund covers: $1,500
Trader loses: $4,500 (their margin)
```

## Risk Management Implications

### For Traders
- **Position Sizing**: Consider bankruptcy price in sizing
- **Stop Losses**: Set above bankruptcy price
- **Leverage Choice**: Higher leverage = closer bankruptcy
- **Margin Monitoring**: Watch for bankruptcy approach

### For Exchanges
- **Liquidation Timing**: Liquidate before bankruptcy
- **Insurance Fund**: Maintain adequate reserves
- **Risk Monitoring**: Track bankruptcy exposure
- **Circuit Breakers**: Halt during extreme moves

## Implementation Considerations

### Technical Requirements
- **Real-time Calculation**: Continuous bankruptcy price updates
- **Price Feeds**: Reliable mark price for calculations
- **Risk Monitoring**: Bankruptcy price alerts
- **Insurance Fund**: Automatic loss coverage

### Operational Considerations
- **Documentation**: Clear bankruptcy policies
- **User Education**: Explain bankruptcy risks
- **Monitoring**: Track bankruptcy events
- **Reporting**: Bankruptcy statistics and analysis

## Bankruptcy Price Tables

### Long Position Bankruptcy Prices
| Entry Price | 5x Leverage | 10x Leverage | 25x Leverage | 50x Leverage | 100x Leverage |
|-------------|-------------|--------------|--------------|--------------|---------------|
| $10,000     | $8,000      | $9,000       | $9,600       | $9,800       | $9,900        |
| $25,000     | $20,000     | $22,500      | $24,000      | $24,500      | $24,750       |
| $50,000     | $40,000     | $45,000      | $48,000      | $49,000      | $49,500       |
| $100,000    | $80,000     | $90,000      | $96,000      | $98,000      | $99,000       |

### Short Position Bankruptcy Prices
| Entry Price | 5x Leverage | 10x Leverage | 25x Leverage | 50x Leverage | 100x Leverage |
|-------------|-------------|--------------|--------------|--------------|---------------|
| $10,000     | $12,000     | $11,000      | $10,400      | $10,200      | $10,100       |
| $25,000     | $30,000     | $27,500      | $26,000      | $25,500      | $25,250       |
| $50,000     | $60,000     | $55,000      | $52,000      | $51,000      | $50,500       |
| $100,000    | $120,000    | $110,000     | $104,000     | $102,000     | $101,000      |