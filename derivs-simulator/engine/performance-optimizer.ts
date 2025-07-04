import { Decimal } from 'decimal.js';
import { MarginCalculator, PositionForMargin } from './margin';
import { User } from './user';

export type RiskLevel = 'safe' | 'warning' | 'urgent' | 'critical';

export interface PositionForOptimizer {
  userId: string;
  side: 'long' | 'short';
  size: Decimal;
  unrealizedPnL?: Decimal;
}

export interface CachedMarginCalculation {
  timestamp: number;
  marginRatio: number;
  liquidationPrice: number | Decimal;
  maintenanceMargin: number | Decimal;
}

export interface OptimizedMarginStatus {
  marginRatio: number;
  equity: number;
  maintenanceMargin: number | Decimal;
  liquidationPrice: number | Decimal;
  distanceToLiquidation: number;
  distancePercentage: number;
  isAtRisk: boolean;
}

export interface LiquidationCandidate {
  position: PositionForOptimizer;
  liquidationPrice: number | Decimal;
  priority: RiskLevel;
}

export interface AtRiskPositions {
  critical: PositionForOptimizer[];
  urgent: PositionForOptimizer[];
  warning: PositionForOptimizer[];
  total: number;
}

export interface PositionUpdate {
  position: PositionForOptimizer;
  marginStatus: OptimizedMarginStatus;
  riskLevel: RiskLevel;
}

export interface PerformanceMetrics {
  positionScans: number;
  cacheHits: number;
  cacheMisses: number;
  avgScanTime: number;
  liquidationChecks: number;
  indexSizes: {
    totalPositions: number;
    marginBuckets: number;
    critical: number;
    urgent: number;
    warning: number;
    safe: number;
  };
  cacheStats: {
    size: number;
    hitRate: number;
  };
}

export interface RiskLevelSets {
  safe: Set<PositionForOptimizer>;
  warning: Set<PositionForOptimizer>;
  urgent: Set<PositionForOptimizer>;
  critical: Set<PositionForOptimizer>;
}

export class PerformanceOptimizer {
  public positionsByMarginRatio: Map<number, Set<PositionForOptimizer>>;
  public positionsByUser: Map<string, PositionForOptimizer>;
  public positionsByRiskLevel: RiskLevelSets;
  public lastMarginCalculation: Map<string, CachedMarginCalculation>;
  public calculationCacheTimeout: number;
  public metrics: Omit<PerformanceMetrics, 'indexSizes' | 'cacheStats'>;

  constructor() {
    // Indexed collections for O(1) lookups
    this.positionsByMarginRatio = new Map<number, Set<PositionForOptimizer>>();
    this.positionsByUser = new Map<string, PositionForOptimizer>();
    this.positionsByRiskLevel = {
      safe: new Set<PositionForOptimizer>(),
      warning: new Set<PositionForOptimizer>(),
      urgent: new Set<PositionForOptimizer>(),
      critical: new Set<PositionForOptimizer>()
    };
    
    // Cached calculations
    this.lastMarginCalculation = new Map<string, CachedMarginCalculation>();
    this.calculationCacheTimeout = 5000; // 5 seconds cache
    
    // Performance metrics
    this.metrics = {
      positionScans: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgScanTime: 0,
      liquidationChecks: 0
    };
  }

  // Optimized position indexing
  indexPosition(position: PositionForOptimizer, marginStatus: OptimizedMarginStatus): void {
    const userId = position.userId;
    const { marginRatio } = marginStatus;
    
    // Remove from old indices if exists
    this.removeFromIndices(userId);
    
    // Add to user index
    this.positionsByUser.set(userId, position);
    
    // Add to margin ratio index (rounded to nearest 10% for bucketing)
    const marginBucket = Math.floor(marginRatio / 10) * 10;
    if (!this.positionsByMarginRatio.has(marginBucket)) {
      this.positionsByMarginRatio.set(marginBucket, new Set<PositionForOptimizer>());
    }
    this.positionsByMarginRatio.get(marginBucket)!.add(position);
    
    // Add to risk level index
    const riskLevel = this.getRiskLevel(marginRatio);
    this.positionsByRiskLevel[riskLevel].add(position);
    
    // Cache margin calculation
    this.lastMarginCalculation.set(userId, {
      timestamp: Date.now(),
      marginRatio,
      liquidationPrice: marginStatus.liquidationPrice,
      maintenanceMargin: marginStatus.maintenanceMargin
    });
  }

  // Remove position from all indices
  removeFromIndices(userId: string): void {
    const existingPosition = this.positionsByUser.get(userId);
    if (!existingPosition) return;
    
    // Remove from margin ratio buckets
    for (const [bucket, positions] of this.positionsByMarginRatio.entries()) {
      positions.delete(existingPosition);
      if (positions.size === 0) {
        this.positionsByMarginRatio.delete(bucket);
      }
    }
    
    // Remove from risk level indices
    Object.values(this.positionsByRiskLevel).forEach(set => {
      set.delete(existingPosition);
    });
    
    // Remove from user index
    this.positionsByUser.delete(userId);
    
    // Clear cache
    this.lastMarginCalculation.delete(userId);
  }

  // Get cached margin calculation if still valid
  getCachedMarginStatus(userId: string): CachedMarginCalculation | null {
    const cached = this.lastMarginCalculation.get(userId);
    if (!cached) {
      this.metrics.cacheMisses++;
      return null;
    }
    
    const age = Date.now() - cached.timestamp;
    if (age > this.calculationCacheTimeout) {
      this.lastMarginCalculation.delete(userId);
      this.metrics.cacheMisses++;
      return null;
    }
    
    this.metrics.cacheHits++;
    return cached;
  }

  // Get risk level from margin ratio
  getRiskLevel(marginRatio: number): RiskLevel {
    if (marginRatio <= 105) return 'critical';
    if (marginRatio <= 120) return 'urgent';
    if (marginRatio <= 150) return 'warning';
    return 'safe';
  }

  // Optimized liquidation candidate selection
  getLiquidationCandidates(currentPrice: Decimal, marginCalculator: MarginCalculator): LiquidationCandidate[] {
    const startTime = Date.now();
    const candidates: LiquidationCandidate[] = [];
    const currentPriceNum = typeof currentPrice === 'number' ? currentPrice : new Decimal(currentPrice).toNumber();
    
    // Only check critical and urgent positions first
    const atRiskPositions = new Set([
      ...this.positionsByRiskLevel.critical,
      ...this.positionsByRiskLevel.urgent
    ]);
    
    atRiskPositions.forEach(position => {
      // Use cached calculation if available and recent
      let liquidationPrice: number | Decimal;
      const cached = this.getCachedMarginStatus(position.userId);
      
      if (cached) {
        liquidationPrice = cached.liquidationPrice;
      } else {
        // Create position object that satisfies PositionForMargin interface
        const positionForMargin: PositionForMargin = {
          side: position.side,
          size: position.size,
          avgEntryPrice: new Decimal(0), // This should be provided by the actual position
          leverage: new Decimal(1), // This should be provided by the actual position
          initialMargin: new Decimal(0), // This should be provided by the actual position
          unrealizedPnL: position.unrealizedPnL || new Decimal(0)
        };
        liquidationPrice = marginCalculator.calculateLiquidationPrice(positionForMargin);
      }
      
      // Check if position should be liquidated
      const liquidationPriceNum = typeof liquidationPrice === 'number' ? liquidationPrice : liquidationPrice.toNumber();
      const shouldLiquidate = position.side === 'long' 
        ? currentPriceNum <= liquidationPriceNum
        : currentPriceNum >= liquidationPriceNum;
      
      if (shouldLiquidate) {
        candidates.push({
          position,
          liquidationPrice,
          priority: this.getRiskLevel(cached?.marginRatio || 100) // Default to critical if no cache
        });
      }
    });
    
    // Sort by priority (critical first)
    candidates.sort((a, b) => {
      const priorityOrder: Record<RiskLevel, number> = { critical: 0, urgent: 1, warning: 2, safe: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    // Update metrics
    const scanTime = Date.now() - startTime;
    this.metrics.liquidationChecks++;
    this.metrics.avgScanTime = (this.metrics.avgScanTime + scanTime) / 2;
    
    return candidates;
  }

  // Optimized margin monitoring for only at-risk positions
  getAtRiskPositions(): AtRiskPositions {
    return {
      critical: Array.from(this.positionsByRiskLevel.critical),
      urgent: Array.from(this.positionsByRiskLevel.urgent),
      warning: Array.from(this.positionsByRiskLevel.warning),
      total: this.positionsByRiskLevel.critical.size + 
             this.positionsByRiskLevel.urgent.size + 
             this.positionsByRiskLevel.warning.size
    };
  }

  // Batch update positions for performance
  batchUpdatePositions(positions: Map<string, PositionForOptimizer>, users: Map<string, User>, currentPrice: Decimal, marginCalculator: MarginCalculator): PositionUpdate[] {
    const startTime = Date.now();
    const updates: PositionUpdate[] = [];
    
    positions.forEach(position => {
      const user = users.get(position.userId);
      if (!user) return;
      
      // Calculate margin status
      const marginStatus = this.calculateMarginStatusOptimized(position, user, currentPrice, marginCalculator);
      
      // Update indices
      this.indexPosition(position, marginStatus);
      
      // Check if needs attention
      if (marginStatus.marginRatio <= 150) { // Only track positions that need monitoring
        updates.push({
          position,
          marginStatus,
          riskLevel: this.getRiskLevel(marginStatus.marginRatio)
        });
      }
    });
    
    // Update metrics
    const scanTime = Date.now() - startTime;
    this.metrics.positionScans++;
    this.metrics.avgScanTime = (this.metrics.avgScanTime + scanTime) / 2;
    
    return updates;
  }

  // Optimized margin status calculation with caching
  calculateMarginStatusOptimized(position: PositionForOptimizer, user: User, currentPrice: Decimal, marginCalculator: MarginCalculator): OptimizedMarginStatus {
    const currentPriceNum = typeof currentPrice === 'number' ? currentPrice : new Decimal(currentPrice).toNumber();
    
    // Check cache first
    const cached = this.getCachedMarginStatus(position.userId);
    if (cached) {
      // Update only the dynamic parts (price-dependent calculations)
      const liquidationPriceNum = typeof cached.liquidationPrice === 'number' ? cached.liquidationPrice : cached.liquidationPrice.toNumber();
      const distanceToLiquidation = Math.abs(currentPriceNum - liquidationPriceNum);
      const distancePercentage = (distanceToLiquidation / currentPriceNum) * 100;
      const unrealizedPnL = position.unrealizedPnL ? new Decimal(position.unrealizedPnL).toNumber() : 0;
      
      return {
        marginRatio: cached.marginRatio,
        equity: user.availableBalance.toNumber() + unrealizedPnL,
        maintenanceMargin: cached.maintenanceMargin,
        liquidationPrice: cached.liquidationPrice,
        distanceToLiquidation,
        distancePercentage,
        isAtRisk: cached.marginRatio <= 105
      };
    }
    
    // Full calculation if not cached - need to create proper PositionForMargin object
    // Note: This is a simplified version - in practice, the position should provide all required fields
    const positionForMargin: PositionForMargin = {
      side: position.side,
      size: position.size,
      avgEntryPrice: new Decimal(0), // Should be provided by actual position
      leverage: new Decimal(1), // Should be provided by actual position  
      initialMargin: new Decimal(0), // Should be provided by actual position
      unrealizedPnL: position.unrealizedPnL || new Decimal(0)
    };
    
    const maintenanceMargin = marginCalculator.calculateMaintenanceMargin(position.size, currentPrice);
    const liquidationPrice = marginCalculator.calculateLiquidationPrice(positionForMargin);
    const unrealizedPnL = position.unrealizedPnL ? new Decimal(position.unrealizedPnL).toNumber() : 0;
    const equity = user.availableBalance.toNumber() + unrealizedPnL;
    const marginRatio = marginCalculator.calculateMarginRatio(positionForMargin, user.availableBalance, currentPrice)?.toNumber() || 0;
    
    const liquidationPriceNum = liquidationPrice.toNumber();
    const distanceToLiquidation = Math.abs(currentPriceNum - liquidationPriceNum);
    const distancePercentage = (distanceToLiquidation / currentPriceNum) * 100;
    
    return {
      marginRatio,
      equity,
      maintenanceMargin,
      liquidationPrice,
      distanceToLiquidation,
      distancePercentage,
      isAtRisk: marginRatio <= 105
    };
  }

  // Get positions by margin ratio range for efficient scanning
  getPositionsByMarginRange(minRatio: number, maxRatio: number): PositionForOptimizer[] {
    const positions = new Set<PositionForOptimizer>();
    
    const minBucket = Math.floor(minRatio / 10) * 10;
    const maxBucket = Math.floor(maxRatio / 10) * 10;
    
    for (let bucket = minBucket; bucket <= maxBucket; bucket += 10) {
      const bucketPositions = this.positionsByMarginRatio.get(bucket);
      if (bucketPositions) {
        bucketPositions.forEach(pos => positions.add(pos));
      }
    }
    
    return Array.from(positions);
  }

  // Performance monitoring
  getPerformanceMetrics(): PerformanceMetrics {
    const cacheHitRate = this.metrics.cacheHits + this.metrics.cacheMisses > 0 
      ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100 
      : 0;

    return {
      ...this.metrics,
      indexSizes: {
        totalPositions: this.positionsByUser.size,
        marginBuckets: this.positionsByMarginRatio.size,
        critical: this.positionsByRiskLevel.critical.size,
        urgent: this.positionsByRiskLevel.urgent.size,
        warning: this.positionsByRiskLevel.warning.size,
        safe: this.positionsByRiskLevel.safe.size
      },
      cacheStats: {
        size: this.lastMarginCalculation.size,
        hitRate: cacheHitRate
      }
    };
  }

  // Clear expired cache entries
  cleanupCache(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [userId, cached] of this.lastMarginCalculation.entries()) {
      if (now - cached.timestamp > this.calculationCacheTimeout) {
        this.lastMarginCalculation.delete(userId);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  // Reset all indices and cache
  reset(): void {
    this.positionsByMarginRatio.clear();
    this.positionsByUser.clear();
    Object.values(this.positionsByRiskLevel).forEach(set => set.clear());
    this.lastMarginCalculation.clear();
    
    // Reset metrics
    this.metrics = {
      positionScans: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgScanTime: 0,
      liquidationChecks: 0
    };
  }
} 