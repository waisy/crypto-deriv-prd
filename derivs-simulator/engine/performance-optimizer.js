class PerformanceOptimizer {
  constructor() {
    // Indexed collections for O(1) lookups
    this.positionsByMarginRatio = new Map(); // marginRatio -> Set of positions
    this.positionsByUser = new Map(); // userId -> position
    this.positionsByRiskLevel = {
      safe: new Set(),
      warning: new Set(),
      urgent: new Set(),
      critical: new Set()
    };
    
    // Cached calculations
    this.lastMarginCalculation = new Map(); // positionId -> { timestamp, marginRatio, liquidationPrice }
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
  indexPosition(position, marginStatus) {
    const userId = position.userId;
    const { marginRatio } = marginStatus;
    
    // Remove from old indices if exists
    this.removeFromIndices(userId);
    
    // Add to user index
    this.positionsByUser.set(userId, position);
    
    // Add to margin ratio index (rounded to nearest 10% for bucketing)
    const marginBucket = Math.floor(marginRatio / 10) * 10;
    if (!this.positionsByMarginRatio.has(marginBucket)) {
      this.positionsByMarginRatio.set(marginBucket, new Set());
    }
    this.positionsByMarginRatio.get(marginBucket).add(position);
    
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
  removeFromIndices(userId) {
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
  getCachedMarginStatus(userId) {
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
  getRiskLevel(marginRatio) {
    if (marginRatio <= 105) return 'critical';
    if (marginRatio <= 120) return 'urgent';
    if (marginRatio <= 150) return 'warning';
    return 'safe';
  }

  // Optimized liquidation candidate selection
  getLiquidationCandidates(currentPrice, marginCalculator) {
    const startTime = Date.now();
    const candidates = [];
    
    // Only check critical and urgent positions first
    const atRiskPositions = new Set([
      ...this.positionsByRiskLevel.critical,
      ...this.positionsByRiskLevel.urgent
    ]);
    
    atRiskPositions.forEach(position => {
      // Use cached calculation if available and recent
      let liquidationPrice = null;
      const cached = this.getCachedMarginStatus(position.userId);
      
      if (cached) {
        liquidationPrice = cached.liquidationPrice;
      } else {
        liquidationPrice = marginCalculator.calculateLiquidationPrice(position);
      }
      
      // Check if position should be liquidated
      const shouldLiquidate = position.side === 'long' 
        ? currentPrice <= liquidationPrice
        : currentPrice >= liquidationPrice;
      
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
      const priorityOrder = { critical: 0, urgent: 1, warning: 2, safe: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    // Update metrics
    const scanTime = Date.now() - startTime;
    this.metrics.liquidationChecks++;
    this.metrics.avgScanTime = (this.metrics.avgScanTime + scanTime) / 2;
    
    return candidates;
  }

  // Optimized margin monitoring for only at-risk positions
  getAtRiskPositions() {
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
  batchUpdatePositions(positions, users, currentPrice, marginCalculator) {
    const startTime = Date.now();
    const updates = [];
    
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
  calculateMarginStatusOptimized(position, user, currentPrice, marginCalculator) {
    // Check cache first
    const cached = this.getCachedMarginStatus(position.userId);
    if (cached) {
      // Update only the dynamic parts (price-dependent calculations)
      const distanceToLiquidation = Math.abs(currentPrice - cached.liquidationPrice);
      const distancePercentage = (distanceToLiquidation / currentPrice) * 100;
      
      return {
        marginRatio: cached.marginRatio,
        equity: user.availableBalance + (position.unrealizedPnL || 0),
        maintenanceMargin: cached.maintenanceMargin,
        liquidationPrice: cached.liquidationPrice,
        distanceToLiquidation,
        distancePercentage,
        isAtRisk: cached.marginRatio <= 105
      };
    }
    
    // Full calculation if not cached
    const maintenanceMargin = marginCalculator.calculateMaintenanceMargin(position.size, currentPrice);
    const liquidationPrice = marginCalculator.calculateLiquidationPrice(position);
    const equity = user.availableBalance + (position.unrealizedPnL || 0);
    const marginRatio = marginCalculator.calculateMarginRatio(position, user.availableBalance, currentPrice);
    
    const distanceToLiquidation = Math.abs(currentPrice - liquidationPrice);
    const distancePercentage = (distanceToLiquidation / currentPrice) * 100;
    
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
  getPositionsByMarginRange(minRatio, maxRatio) {
    const positions = new Set();
    
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
  getPerformanceMetrics() {
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
        hitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100
      }
    };
  }

  // Clear expired cache entries
  cleanupCache() {
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
  reset() {
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

module.exports = { PerformanceOptimizer }; 