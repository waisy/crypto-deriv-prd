# Risk Replica System - Technical Design Document

## Executive Summary

The Risk Replica System is a distributed, high-performance risk monitoring architecture designed to continuously evaluate liquidation risk across millions of positions in real-time. This system operates as a read-only replica of the main exchange's risk data, providing redundancy, scalability, and specialized optimization for risk calculations without impacting the primary trading system's performance.

## System Overview

### Core Objectives
- **Continuous Risk Monitoring**: Evaluate liquidation risk for millions of positions in real-time
- **High Availability**: Provide redundant risk calculations separate from main exchange
- **Performance Optimization**: Handle massive scale with sub-second response times
- **Data Consistency**: Maintain synchronized view of positions, balances, and market data
- **Operational Safety**: Enable proactive risk management and circuit breakers

### Key Components
1. **Data Replication Layer**: Streams position, balance, and order data from main exchange
2. **Risk Calculation Engine**: Specialized processing units for liquidation evaluations
3. **Market Data Processor**: Real-time price feed integration and mark price calculations
4. **Event Processing Pipeline**: Handles various triggers for risk recalculation
5. **Storage & Caching Layer**: Optimized data structures for fast risk queries
6. **Alert & Action System**: Notifications and automated responses to risk events

## Architecture Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN EXCHANGE SYSTEM                         │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Positions     │    Balances     │      Open Orders            │
│   Database      │    Database     │      Database               │
└─────────────────┴─────────────────┴─────────────────────────────┘
         │                 │                       │
         │                 │                       │
    ┌────▼─────────────────▼───────────────────────▼────┐
    │           REPLICATION PIPELINE                    │
    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
    │  │ Position    │ │ Balance     │ │ Order       │  │
    │  │ Log Stream  │ │ Log Stream  │ │ Log Stream  │  │
    │  └─────────────┘ └─────────────┘ └─────────────┘  │
    └───────────────────────┼───────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────┐
│                RISK REPLICA SYSTEM                    │
├───────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Market Data    │  │     Event Processor         │  │
│  │  Processor      │  │  ┌─────────────────────────┐  │  │
│  │  ┌───────────┐  │  │  │ Price Update Events     │  │  │
│  │  │Mark Price │  │  │  │ Position Change Events  │  │  │
│  │  │Calculator │  │  │  │ Balance Update Events   │  │  │
│  │  └───────────┘  │  │  │ Order Events           │  │  │
│  └─────────────────┘  │  └─────────────────────────┘  │  │
│                       └─────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────┐  │
│  │           RISK CALCULATION ENGINE                │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │  │
│  │  │ Liquidation │ │   Margin    │ │     ADL     │  │  │
│  │  │   Engine    │ │ Calculator  │ │  Evaluator  │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────┐  │
│  │            STORAGE & CACHING                    │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │  │
│  │  │  Position   │ │  Risk Cache │ │   Market    │  │  │
│  │  │   Store     │ │             │ │   Data      │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────┐  │
│  │          ALERT & ACTION SYSTEM                  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │  │
│  │  │Risk Alerts  │ │  Circuit    │ │ Monitoring  │  │  │
│  │  │& Warnings   │ │ Breakers    │ │ Dashboard   │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### Data Replication Strategy

#### Replication Architecture
- **Change Data Capture (CDC)**: Real-time streaming from main database
- **Event Sourcing**: Position/balance changes as immutable event log
- **Multi-Stream Processing**: Separate streams for positions, balances, orders
- **Guaranteed Delivery**: At-least-once delivery with deduplication

#### Replication Lag Management
```
Target Latencies:
- Critical Updates: < 50ms (liquidations, large position changes)
- Standard Updates: < 200ms (normal trades, balance changes)
- Bulk Updates: < 1s (funding payments, batch operations)
```

#### Data Consistency Models
- **Eventually Consistent**: For non-critical risk metrics
- **Strong Consistency**: For liquidation-critical calculations
- **Causal Consistency**: Position updates must reflect in correct order

## Risk Calculation Engine

### Position Risk Evaluation

#### Core Risk Metrics Calculated
```typescript
interface PositionRisk {
  positionId: string;
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentMarkPrice: number;
  
  // Risk Calculations
  unrealizedPnL: number;
  marginRatio: number;
  liquidationPrice: number;
  bankruptcyPrice: number;
  maintenanceMargin: number;
  
  // Risk Indicators
  riskLevel: 'safe' | 'warning' | 'danger' | 'critical';
  liquidationDistance: number; // Price distance to liquidation
  adlScore?: number; // For profitable positions
  
  // Timestamps
  lastUpdated: number;
  lastPriceUpdate: number;
}
```

#### Liquidation Distance Calculation
```typescript
function calculateLiquidationDistance(position: Position, markPrice: number): number {
  const liquidationPrice = calculateLiquidationPrice(position);
  
  if (position.side === 'long') {
    return (markPrice - liquidationPrice) / markPrice;
  } else {
    return (liquidationPrice - markPrice) / markPrice;
  }
}
```

### Optimization Strategies

#### When to Recalculate Positions

##### Event-Driven Recalculation Priority Matrix
```
                    │ Immediate │ Batched │ Deferred │
                    │  (<10ms)  │(<100ms) │ (<1s)    │
────────────────────┼───────────┼─────────┼──────────┤
Price Update        │     ■     │         │          │
Large Position Chg  │     ■     │         │          │
Margin Addition     │           │    ■    │          │
Small Position Chg  │           │    ■    │          │
Funding Payment     │           │         │    ■     │
Order Placement     │           │         │    ■     │
```

##### Mark Price Update Frequency Analysis
```
Market Conditions    │ Update Freq │ Risk Calc Freq │ Reasoning
────────────────────┼─────────────┼────────────────┼──────────────────
Normal Volatility   │   1 second  │   1 second     │ Balanced performance
High Volatility     │  100ms      │  100ms         │ Critical risk period
Extreme Volatility  │   50ms      │   50ms         │ Emergency mode
Low Volatility      │   5 seconds │   2 seconds    │ Conserve resources
```

#### Selective Position Updates

##### Risk-Based Update Prioritization
```typescript
enum UpdatePriority {
  CRITICAL = 1,    // Positions near liquidation (margin ratio < 110%)
  HIGH = 2,        // Warning positions (margin ratio < 150%)
  MEDIUM = 3,      // Large positions (> $100k notional)
  LOW = 4,         // Safe positions (margin ratio > 200%)
  DEFERRED = 5     // Minimal positions (< $1k notional)
}

function determineUpdatePriority(position: PositionRisk): UpdatePriority {
  if (position.marginRatio < 110) return UpdatePriority.CRITICAL;
  if (position.marginRatio < 150) return UpdatePriority.HIGH;
  if (position.size * position.currentMarkPrice > 100000) return UpdatePriority.MEDIUM;
  if (position.marginRatio > 200) return UpdatePriority.LOW;
  return UpdatePriority.DEFERRED;
}
```

##### Batch Processing Strategy
```typescript
interface BatchProcessor {
  // Process by priority queues
  criticalQueue: PositionRisk[];  // Every price update
  highQueue: PositionRisk[];      // Every 2 price updates
  mediumQueue: PositionRisk[];    // Every 5 price updates
  lowQueue: PositionRisk[];       // Every 10 price updates
  deferredQueue: PositionRisk[];  // Every 30 price updates
}
```

### Scalability Architecture

#### Horizontal Partitioning Strategy

##### Position Sharding
```
Shard Key: hash(user_id) % num_shards

Benefits:
- Even distribution of risk calculations
- User-specific caching effectiveness
- Parallel processing of user portfolios
- Isolated failure impact
```

##### Market-Based Partitioning
```
Primary Shard: By symbol (BTC-PERP, ETH-PERP, etc.)
Secondary Shard: By risk level within symbol

Advantages:
- Symbol-specific optimizations
- Focused market data distribution
- Risk-level based resource allocation
```

#### Processing Architecture

##### Multi-Tier Processing
```
Tier 1: Ultra-Fast (Critical Risk)
- In-memory processing
- Dedicated CPU cores
- < 10ms latency target
- Positions near liquidation

Tier 2: Fast (High Risk)
- Memory + SSD caching
- Shared CPU resources
- < 100ms latency target
- Warning-level positions

Tier 3: Standard (Medium/Low Risk)
- Standard database queries
- Batch processing
- < 1s latency target
- Safe positions
```

## Performance Optimizations

### Caching Strategy

#### Multi-Level Caching
```
L1 Cache (Redis): Hot positions, recent prices
- Ultra-low latency access
- 10GB memory allocation
- TTL: 30 seconds

L2 Cache (Application): Risk calculations, market data
- In-process memory
- 50GB allocation per instance
- TTL: 5 minutes

L3 Cache (Database): Historical data, complex queries
- PostgreSQL query cache
- Materialized views for aggregations
- Refresh: Every 10 minutes
```

#### Cache Invalidation Strategy
```typescript
// Event-driven cache invalidation
interface CacheInvalidation {
  onPriceUpdate: (symbol: string) => void;
  onPositionChange: (userId: string, positionId: string) => void;
  onBalanceUpdate: (userId: string) => void;
  onOrderUpdate: (userId: string, orderId: string) => void;
}
```

### Database Optimization

#### Index Strategy
```sql
-- Critical indexes for risk calculations
CREATE INDEX CONCURRENTLY idx_positions_risk_level 
  ON positions (risk_level, symbol) 
  WHERE status = 'open';

CREATE INDEX CONCURRENTLY idx_positions_liquidation_distance 
  ON positions (liquidation_distance) 
  WHERE liquidation_distance < 0.05;

-- Composite index for batch processing
CREATE INDEX CONCURRENTLY idx_positions_update_priority 
  ON positions (update_priority, last_calculated) 
  WHERE status = 'open';
```

#### Materialized Views for Aggregations
```sql
-- System-wide risk aggregation
CREATE MATERIALIZED VIEW risk_summary AS
  SELECT 
    symbol,
    COUNT(*) as total_positions,
    COUNT(*) FILTER (WHERE risk_level = 'critical') as critical_positions,
    COUNT(*) FILTER (WHERE risk_level = 'danger') as danger_positions,
    AVG(margin_ratio) as avg_margin_ratio,
    SUM(abs(unrealized_pnl)) as total_unrealized_pnl
  FROM positions 
  WHERE status = 'open'
  GROUP BY symbol;

-- Refresh every 30 seconds
SELECT cron.schedule('refresh-risk-summary', '*/30 * * * * *', 
  'REFRESH MATERIALIZED VIEW CONCURRENTLY risk_summary;');
```

## Event Processing Pipeline

### Event Types and Handling

#### Critical Events (Immediate Processing)
```typescript
interface CriticalEvent {
  type: 'PRICE_UPDATE' | 'LARGE_POSITION_CHANGE' | 'MARGIN_DEPLETION';
  timestamp: number;
  data: {
    symbol?: string;
    markPrice?: number;
    userId?: string;
    positionId?: string;
    marginRatio?: number;
  };
}
```

#### Processing Flow
```
Event Ingestion → Event Classification → Priority Queue → Batch Formation → Risk Calculation → Result Cache → Alert Generation
```

### Real-Time Processing Requirements

#### Throughput Targets
```
Event Processing Capacity:
- Price Updates: 10,000/second
- Position Changes: 50,000/second  
- Balance Updates: 25,000/second
- Order Events: 100,000/second

Risk Calculation Capacity:
- Critical: 1,000,000 positions/second
- High Priority: 5,000,000 positions/second
- Standard: 10,000,000 positions/second
```

## Alert & Monitoring System

### Risk Alert Categories

#### User-Level Alerts
```typescript
interface UserAlert {
  type: 'MARGIN_WARNING' | 'LIQUIDATION_IMMINENT' | 'POSITION_LIQUIDATED';
  severity: 'info' | 'warning' | 'critical';
  userId: string;
  positionId: string;
  message: string;
  actionRequired: boolean;
  autoLiquidationIn?: number; // seconds
}
```

#### System-Level Alerts
```typescript
interface SystemAlert {
  type: 'HIGH_LIQUIDATION_VOLUME' | 'INSURANCE_FUND_LOW' | 'ADL_TRIGGERED';
  severity: 'warning' | 'critical' | 'emergency';
  affectedSymbol: string;
  impact: {
    positionsAffected: number;
    totalNotional: number;
    insuranceFundBalance: number;
  };
}
```

### Circuit Breaker Implementation

#### Market-Level Circuit Breakers
```typescript
interface CircuitBreaker {
  symbol: string;
  priceDeviationThreshold: number; // 5% in 1 minute
  liquidationVolumeThreshold: number; // $10M in 5 minutes
  marginRatioThreshold: number; // <50% for >1000 positions
  
  actions: {
    haltTrading: boolean;
    increaseFundingFrequency: boolean;
    raiseMaintenanceMargin: boolean;
    notifyRiskTeam: boolean;
  };
}
```

## Implementation Roadmap

### Phase 1: Core Infrastructure (Weeks 1-4)
- [ ] Set up data replication pipeline
- [ ] Implement basic position storage and caching
- [ ] Create risk calculation engine framework
- [ ] Build event processing pipeline

### Phase 2: Risk Calculations (Weeks 5-8)  
- [ ] Implement liquidation price calculations
- [ ] Add margin ratio monitoring
- [ ] Create ADL score calculations
- [ ] Build basic alerting system

### Phase 3: Performance Optimization (Weeks 9-12)
- [ ] Implement caching layers
- [ ] Add batch processing capabilities
- [ ] Optimize database queries and indexes
- [ ] Load testing and performance tuning

### Phase 4: Advanced Features (Weeks 13-16)
- [ ] Circuit breaker implementation
- [ ] Advanced risk analytics
- [ ] Real-time dashboard
- [ ] Integration with main exchange systems

### Phase 5: Production Deployment (Weeks 17-20)
- [ ] Full system testing
- [ ] Disaster recovery procedures
- [ ] Production deployment
- [ ] Monitoring and alerting setup

## Risk Assessment & Mitigation

### Technical Risks
```
Risk: Data replication lag
Impact: Stale risk calculations
Mitigation: Multiple replication streams, health monitoring

Risk: Cache inconsistency  
Impact: Incorrect risk assessments
Mitigation: Event-driven invalidation, validation checks

Risk: System overload
Impact: Performance degradation
Mitigation: Auto-scaling, circuit breakers, priority queues
```

### Operational Risks
```
Risk: False liquidation alerts
Impact: User experience degradation
Mitigation: Multi-stage validation, manual review process

Risk: Missed liquidations
Impact: Exchange losses
Mitigation: Redundant calculations, alert escalation

Risk: System failure during high volatility
Impact: Risk management failure
Mitigation: Hot standby systems, manual override capabilities
```

## Monitoring & Observability

### Key Performance Indicators
```
Latency Metrics:
- Event processing latency (p50, p95, p99)
- Risk calculation time per position
- Alert generation time

Accuracy Metrics:
- False positive rate for liquidation alerts
- Missed liquidation events
- Data consistency between primary and replica

Throughput Metrics:
- Events processed per second
- Risk calculations per second
- Cache hit rates
```

### Health Checks & SLAs
```
System Health Targets:
- 99.9% uptime
- <100ms average risk calculation latency
- <1% false positive rate on critical alerts
- <0.01% missed liquidation events

Alert Thresholds:
- Replication lag > 500ms
- Cache hit rate < 95%
- Risk calculation errors > 0.1%
- Event processing backlog > 10,000
```

## Conclusion

The Risk Replica System provides a robust, scalable solution for real-time risk monitoring across millions of positions. By implementing intelligent prioritization, multi-tier processing, and comprehensive caching strategies, the system can handle extreme scale while maintaining the low-latency requirements critical for derivatives trading.

The architecture balances performance optimization with operational safety, ensuring that risk calculations remain accurate and timely even under extreme market conditions. The phased implementation approach allows for iterative improvement and validation while maintaining system stability throughout development.