# Position Updates

> **Status**: 🤖 AI Generated (Unreviewed) | **Last Updated**: 2025-03-09 | **Needs**: External validation, manual review

## Overview

Position updates are the real-time mechanism by which traders' positions are modified, PnL is calculated, and risk is managed. Understanding this process is crucial for building a robust derivatives exchange.

## Position Update Triggers

### Market Events
- **Price Changes**: Mark price updates
- **Trades**: Order execution
- **Funding**: Periodic funding payments
- **Liquidation**: Automatic position closure

### User Actions
- **New Orders**: Opening positions
- **Closing Orders**: Reducing positions
- **Margin Changes**: Adding/withdrawing collateral
- **Leverage Changes**: Modifying position leverage

## Real-time Update Process

### 1. Price Update
```
Trigger: Mark price changes
Frequency: Every 100ms-1 second
Action: Recalculate all position PnL
```

### 2. PnL Calculation
```
For Long Positions:
Unrealized PnL = (Current Mark Price - Average Entry Price) × Position Size

For Short Positions:
Unrealized PnL = (Average Entry Price - Current Mark Price) × Position Size
```

### 3. Margin Ratio Update
```
Margin Ratio = (Available Balance + Unrealized PnL) / Used Margin × 100%

If Margin Ratio < Maintenance Margin:
- Trigger liquidation warning
- Execute liquidation if below threshold
```

## Position Update Examples

### Example 1: Price Increase (Long Position)
```
Initial State:
- Position: Long 1 BTC at $45,000
- Leverage: 10x
- Initial Margin: $4,500
- Current Price: $45,000

Price Update to $46,000:
- Unrealized PnL: +$1,000
- Available Balance: $5,500
- Margin Ratio: 122%
- Status: Safe
```

### Example 2: Price Decrease (Short Position)
```
Initial State:
- Position: Short 1 BTC at $45,000
- Leverage: 10x
- Initial Margin: $4,500
- Current Price: $45,000

Price Update to $44,000:
- Unrealized PnL: +$1,000
- Available Balance: $5,500
- Margin Ratio: 122%
- Status: Safe
```

### Example 3: Liquidation Trigger
```
Initial State:
- Position: Long 1 BTC at $45,000
- Leverage: 10x
- Initial Margin: $4,500
- Maintenance Margin: $900

Price Update to $41,400:
- Unrealized PnL: -$3,600
- Available Balance: $900
- Margin Ratio: 100%
- Status: Liquidation triggered
```

## Position Update Components

### Core Fields
```
Position ID: Unique identifier
User ID: Trader identifier
Symbol: Trading pair (e.g., BTC-PERP)
Side: Long/Short
Size: Position quantity
Entry Price: Average entry price
Current Price: Latest mark price
Unrealized PnL: Current profit/loss
Realized PnL: Closed position PnL
Margin Used: Collateral allocated
Leverage: Position leverage
```

### Calculated Fields
```
Margin Ratio: Risk indicator
Liquidation Price: Auto-liquidation level
Bankruptcy Price: Zero margin level
ROE: Return on equity
Funding Payments: Cumulative funding
```

## Update Frequency and Performance

### Update Intervals
```
Price Updates: 100ms-1 second
PnL Calculations: Every price update
Margin Checks: Every PnL update
Liquidation Checks: Every margin check
Funding Updates: Every 8 hours
```

### Performance Optimization
```
Batch Updates: Process multiple positions
Caching: Store calculated values
Indexing: Fast position lookups
Sharding: Distribute across servers
```

## Position Update Scenarios

### Scenario 1: Normal Trading
```
1. User places buy order
2. Order matches with sell order
3. Position created/updated
4. PnL calculated immediately
5. Margin ratio updated
6. User receives confirmation
```

### Scenario 2: Funding Payment
```
1. Funding rate calculated
2. All positions updated
3. Long positions: PnL decreases
4. Short positions: PnL increases
5. Margin balances adjusted
6. Liquidation checks performed
```

### Scenario 3: Liquidation Event
```
1. Price moves against position
2. Margin ratio drops below threshold
3. Liquidation warning sent
4. Position closed at market price
5. Losses calculated
6. Insurance fund covers if needed
```

## Risk Management Updates

### Real-time Monitoring
```
Margin Ratio Tracking:
- Safe: > 150%
- Warning: 100-150%
- Danger: 50-100%
- Liquidation: < 50%

Position Limits:
- Maximum position size
- Maximum leverage
- Maximum open interest
```

### Circuit Breakers
```
Volatility Triggers:
- Price change > 5% in 5 minutes
- Trading halt for 5 minutes
- Position updates paused
- Emergency procedures activated
```

## Data Consistency

### ACID Properties
```
Atomicity: All updates succeed or fail together
Consistency: Data remains valid after updates
Isolation: Updates don't interfere with each other
Durability: Updates persist after system restart
```

### Update Validation
```
Pre-update Checks:
- Sufficient margin
- Position limits
- Risk parameters
- User permissions

Post-update Verification:
- Balance consistency
- PnL accuracy
- Risk compliance
- Audit trail
```

## Implementation Considerations

### Database Design
```
Position Table:
- Primary key: Position ID
- Indexes: User ID, Symbol, Status
- Constraints: Non-negative balances
- Triggers: Automatic updates

Update Log:
- Timestamp: Update time
- User ID: Affected user
- Change Type: Update reason
- Old Value: Previous state
- New Value: Current state
```

### API Design
```
REST Endpoints:
GET /positions - List user positions
GET /positions/{id} - Get specific position
POST /positions - Open new position
PUT /positions/{id} - Update position
DELETE /positions/{id} - Close position

WebSocket Updates:
- Real-time position changes
- PnL updates
- Margin warnings
- Liquidation alerts
```

### Error Handling
```
Update Failures:
- Insufficient margin
- Position not found
- Invalid parameters
- System errors

Recovery Procedures:
- Rollback transactions
- Retry mechanisms
- Manual intervention
- Audit logging
```

## Monitoring and Analytics

### Key Metrics
```
Update Performance:
- Update latency
- Throughput
- Error rates
- System load

Position Analytics:
- Average position size
- Leverage distribution
- PnL distribution
- Liquidation frequency
```

### Alerting
```
Critical Alerts:
- High update latency
- Failed updates
- System errors
- Risk threshold breaches

Operational Alerts:
- Performance degradation
- Resource usage
- User complaints
- Market anomalies 