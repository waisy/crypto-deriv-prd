# Liquidation Engine Mechanics

> **Status**: 🤖 AI Generated (Unreviewed) | **Last Updated**: 2025-03-09 | **Needs**: External validation, manual review

## Overview
The liquidation engine is a critical component that maintains the zero-sum invariant (longs = shorts) while managing position liquidations when traders hit maintenance margin requirements.

## Core Principles

### 1. Position Transfer Mechanism
When a position hits liquidation:
- Position is **transferred** to the liquidation engine (not destroyed)
- User gets closed out at bankruptcy price (no remaining equity)
- Long/short balance maintained: user position → liquidation engine position
- Insurance Fund temporarily "covers" any shortfall

### 2. Zero-Sum Invariant
```
Before liquidation: User positions + Other positions = 0 (long - short = 0)
During liquidation: Liquidation engine + Other positions = 0
After liquidation: Final counterparty + Other positions = 0
```

### 3. Liquidation Engine Position Management
The liquidation engine holds positions temporarily while attempting to close them:
- Receives position at bankruptcy price
- Tries to close via order book
- If successful: realises profit/loss, settles with Insurance Fund
- If unsuccessful: triggers ADL mechanism

## Liquidation Process Flow

### Step 1: Position Transfer
```
User Position: 10 BTC Long @ $40k entry, bankruptcy price $36k
Mark Price: $35k (liquidation triggered)

Transfer:
- User position → Liquidation Engine at $36k bankruptcy price
- User balance: $0 (closed at bankruptcy)
- Liquidation Engine: 10 BTC Long @ $36k cost basis
- Current unrealized loss: (35k - 36k) × 10 = -$10k
```

### Step 2: Insurance Fund Coverage
```
Insurance Fund temporarily covers the $10k unrealized loss
This maintains solvency while liquidation engine operates
Position accounting still balanced: LE Long 10 = Others Short 10
```

### Step 3: Order Book Liquidation Attempt
```
Scenario A - Successful liquidation at $35.5k:
- Liquidation Engine sells 10 BTC @ $35.5k
- Realized loss: (35.5k - 36k) × 10 = -$5k
- Insurance Fund pays $5k loss
- Position transferred to buyer: 10 BTC Long @ $35.5k

Scenario B - No order book liquidity:
- Position remains with Liquidation Engine
- Unrealized loss continues growing
- Insurance Fund exposure increases
- Triggers ADL if IF insufficient
```

### Step 4: ADL Mechanism (Emergency Position Transfer)
When order book fails and Insurance Fund insufficient:

```
ADL Selection:
1. Identify opposite side positions (shorts for long liquidation)
2. Calculate ADL scores: %PnL × Effective Leverage (if profitable)
3. Rank by score (highest first)
4. Force trades between liquidation position and ADL positions

ADL Execution:
- LE has 10 BTC Long @ $36k
- Force ADL positions to buy at $36k (LE's cost basis)
- LE realizes $0 P&L (breakeven)
- ADL traders get less profit than market value
- Position fully transferred: LE → ADL traders
```

## Insurance Fund Mechanics

### Function
- **Temporary coverage**: Covers unrealized losses during liquidation process
- **Profit collection**: Receives profits from successful liquidations
- **Loss absorption**: Pays for liquidation losses up to fund balance

### Balance Tracking
```javascript
Insurance Fund Operations:
+ Profitable liquidation (closed above bankruptcy price)
- Unprofitable liquidation (closed below bankruptcy price)
- Temporary coverage of unrealized losses during liquidation
```

### Depletion Trigger
When Insurance Fund cannot cover liquidation engine's unrealized losses:
→ Trigger ADL mechanism for emergency position transfer

## Implementation Requirements

### Liquidation Engine State
- Track positions received from liquidations
- Monitor unrealized P&L on held positions
- Calculate insurance fund requirements
- Manage order book liquidation attempts

### Position Accounting
- Maintain long/short balance at all times
- Track position transfers: User → LE → Final counterparty
- Ensure no positions are "lost" or created

### Manual Controls
- Display liquidation engine positions
- Manual trigger for liquidation steps
- Step-by-step execution for debugging

### ADL Integration
- Position ranking and scoring
- Forced trade execution
- Position transfer completion

## Risk Management
- Insurance Fund monitoring
- Maximum position size limits for liquidation engine
- Emergency procedures when ADL insufficient
- Exchange bankruptcy conditions

## Key Insights
1. **Positions are never destroyed** - only transferred between entities
2. **Insurance Fund provides liquidity** - not position counterparties
3. **ADL is the final position transfer mechanism** - ensures positions always find a home
4. **Order book liquidation is preferred** - but ADL ensures system stability
5. **Zero-sum invariant is sacred** - maintained throughout entire process 