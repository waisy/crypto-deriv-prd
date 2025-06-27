# Mark Price vs Index Price

## Overview

In derivatives trading, two critical price concepts ensure fair trading and prevent manipulation: **Index Price** and **Mark Price**. Understanding the difference is crucial for risk management and position valuation.

## Index Price

### Definition
The Index Price represents the "true" market price of the underlying asset, calculated from multiple spot exchanges to prevent manipulation.

### Calculation Method
```
Index Price = Weighted Average of Spot Prices from Multiple Exchanges

Example:
- Binance: $45,000 (weight: 40%)
- Coinbase: $44,950 (weight: 30%)
- Kraken: $45,050 (weight: 20%)
- Bitfinex: $44,900 (weight: 10%)

Index Price = (45,000 × 0.4) + (44,950 × 0.3) + (45,050 × 0.2) + (44,900 × 0.1)
Index Price = $44,985
```

### Characteristics
- **Manipulation Resistant**: Multiple data sources
- **Stable**: Less volatile than perpetual price
- **Transparent**: Public calculation methodology
- **Real-time**: Updated every few seconds

### Use Cases
- Funding rate calculation
- Liquidation price determination
- Bankruptcy price calculation
- Fair value reference

## Mark Price

### Definition
The Mark Price is the "fair" price of the perpetual contract, calculated using the Index Price and a premium/discount mechanism to prevent manipulation.

### Calculation Method
```
Mark Price = Index Price × (1 + Premium Index)

Where Premium Index is calculated from order book depth:
Premium Index = (Impact Bid - Impact Ask) / Impact Mid Price

Impact Bid/Ask = Weighted average of top N orders
```

### Characteristics
- **Manipulation Resistant**: Uses order book depth
- **Smooth**: Prevents sudden price jumps
- **Fair**: Reflects true market conditions
- **Dynamic**: Updates with market changes

### Use Cases
- PnL calculation
- Margin requirement checks
- Position valuation
- Risk management

## Key Differences

| Aspect | Index Price | Mark Price |
|--------|-------------|------------|
| **Source** | Spot exchanges | Order book depth |
| **Purpose** | True asset value | Fair contract value |
| **Volatility** | Lower | Higher |
| **Update Frequency** | Every few seconds | Real-time |
| **Manipulation Risk** | Very low | Low |

## Price Manipulation Prevention

### Index Price Protection
- **Multiple Sources**: 5-10 spot exchanges
- **Outlier Removal**: Exclude extreme prices
- **Volume Weighting**: Higher volume = higher weight
- **Time Decay**: Recent prices weighted more

### Mark Price Protection
- **Depth Weighting**: Large orders have less impact
- **Smoothing**: Prevents sudden jumps
- **Circuit Breakers**: Halt trading during manipulation
- **Position Limits**: Prevent large position influence

## Example Scenarios

### Scenario 1: Normal Market
```
Index Price: $45,000
Order Book: Balanced
Mark Price: $45,000
Funding Rate: 0.01% (minimal)
```

### Scenario 2: Bullish Pressure
```
Index Price: $45,000
Order Book: Heavy buying pressure
Mark Price: $45,500
Funding Rate: 1.11% (longs pay shorts)
```

### Scenario 3: Bearish Pressure
```
Index Price: $45,000
Order Book: Heavy selling pressure
Mark Price: $44,500
Funding Rate: -1.11% (shorts pay longs)
```

## Implementation Considerations

### Index Price Sources
- **Major Exchanges**: Binance, Coinbase, Kraken
- **Geographic Diversity**: Global price representation
- **Volume Requirements**: Minimum trading volume
- **Price Quality**: Bid-ask spread monitoring

### Mark Price Calculation
- **Depth Analysis**: Top 10-20 orders
- **Impact Calculation**: Price impact of large orders
- **Smoothing Algorithm**: Moving average or EMA
- **Circuit Breakers**: Emergency price limits

### Update Frequency
- **Index Price**: Every 1-5 seconds
- **Mark Price**: Every 100ms-1 second
- **Funding Rate**: Every 8 hours
- **Emergency Updates**: As needed

## Risk Management

### Price Deviation Limits
- **Maximum Deviation**: ±5% from index price
- **Warning Threshold**: ±3% deviation
- **Emergency Action**: ±10% deviation
- **Trading Halt**: ±15% deviation

### Monitoring Systems
- **Real-time Alerts**: Price deviation notifications
- **Historical Analysis**: Pattern recognition
- **Manipulation Detection**: Unusual order patterns
- **Automated Response**: Circuit breakers

## Best Practices

### For Traders
- Monitor both prices for market conditions
- Use mark price for PnL calculations
- Consider index price for fair value
- Watch for price manipulation signs

### For Exchanges
- Transparent price calculation
- Multiple data sources for index
- Robust manipulation detection
- Clear communication during issues 