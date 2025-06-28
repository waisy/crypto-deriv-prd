class MarginMonitor {
  constructor(marginCalculator = null) {
    this.marginCalculator = marginCalculator;
    this.marginCallThresholds = {
      warning: 150,   // 150% margin ratio - warning level
      urgent: 120,    // 120% margin ratio - urgent warning
      critical: 105   // 105% margin ratio - critical warning (liquidation imminent)
    };
    this.marginCalls = new Map(); // userId -> marginCallData
    this.lastNotificationTime = new Map(); // userId -> timestamp
    this.notificationCooldown = 30000; // 30 seconds between notifications
  }

  // Monitor all positions and generate margin calls
  monitorPositions(positions, users, currentPrice) {
    const marginCallUpdates = [];
    
    positions.forEach(position => {
      const user = users.get(position.userId);
      if (!user) return;
      
      const marginStatus = this.calculateMarginStatus(position, user, currentPrice);
      
      // Check if margin call is needed
      const marginCall = this.checkMarginCall(position, marginStatus);
      
      if (marginCall) {
        this.marginCalls.set(position.userId, marginCall);
        marginCallUpdates.push(marginCall);
        
        // Log margin call
        console.warn(`MARGIN CALL - ${marginCall.level}: ${position.userId} - Margin Ratio: ${marginStatus.marginRatio.toFixed(2)}%`);
      } else {
        // Clear margin call if position is now safe
        if (this.marginCalls.has(position.userId)) {
          this.marginCalls.delete(position.userId);
        }
      }
    });
    
    return marginCallUpdates;
  }

  // Calculate detailed margin status for a position
  calculateMarginStatus(position, user, currentPrice) {
    if (!this.marginCalculator) {
      throw new Error('MarginCalculator not available');
    }
    
    const maintenanceMargin = this.marginCalculator.calculateMaintenanceMargin(position.size, currentPrice);
    const liquidationPrice = this.marginCalculator.calculateLiquidationPrice(position);
    
    // Calculate equity (available balance + unrealized PnL)
    const equity = user.availableBalance + (position.unrealizedPnL || 0);
    
    // Calculate margin ratio
    const marginRatio = this.marginCalculator.calculateMarginRatio(position, user.availableBalance, currentPrice);
    
    // Calculate distance to liquidation
    const distanceToLiquidation = Math.abs(currentPrice - liquidationPrice);
    const distancePercentage = (distanceToLiquidation / currentPrice) * 100;
    
    return {
      marginRatio,
      equity,
      maintenanceMargin,
      liquidationPrice,
      distanceToLiquidation,
      distancePercentage,
      isAtRisk: marginRatio <= this.marginCallThresholds.critical
    };
  }

  // Check if position needs a margin call
  checkMarginCall(position, marginStatus) {
    const { marginRatio } = marginStatus;
    const userId = position.userId;
    
    // Determine margin call level
    let level = null;
    if (marginRatio <= this.marginCallThresholds.critical) {
      level = 'CRITICAL';
    } else if (marginRatio <= this.marginCallThresholds.urgent) {
      level = 'URGENT';
    } else if (marginRatio <= this.marginCallThresholds.warning) {
      level = 'WARNING';
    }
    
    if (!level) return null;
    
    // Check notification cooldown
    const lastNotification = this.lastNotificationTime.get(userId) || 0;
    const timeSinceLastNotification = Date.now() - lastNotification;
    
    // Always send critical notifications, respect cooldown for others
    const shouldNotify = level === 'CRITICAL' || timeSinceLastNotification >= this.notificationCooldown;
    
    if (shouldNotify) {
      this.lastNotificationTime.set(userId, Date.now());
    }
    
    return {
      userId,
      positionId: position.userId, // One-way mode
      level,
      marginRatio,
      liquidationPrice: marginStatus.liquidationPrice,
      distanceToLiquidation: marginStatus.distanceToLiquidation,
      distancePercentage: marginStatus.distancePercentage,
      maintenanceMargin: marginStatus.maintenanceMargin,
      equity: marginStatus.equity,
      shouldNotify,
      timestamp: Date.now(),
      message: this.generateMarginCallMessage(level, marginStatus)
    };
  }

  // Generate human-readable margin call message
  generateMarginCallMessage(level, marginStatus) {
    const { marginRatio, distancePercentage, liquidationPrice } = marginStatus;
    
    switch (level) {
      case 'CRITICAL':
        return `🚨 LIQUIDATION IMMINENT: Margin ratio ${marginRatio.toFixed(1)}%. Liquidation at $${liquidationPrice.toFixed(2)} (${distancePercentage.toFixed(2)}% away). Add margin immediately!`;
      
      case 'URGENT':
        return `⚠️ URGENT MARGIN CALL: Margin ratio ${marginRatio.toFixed(1)}%. Liquidation at $${liquidationPrice.toFixed(2)} (${distancePercentage.toFixed(2)}% away). Consider adding margin.`;
      
      case 'WARNING':
        return `📢 Margin Warning: Margin ratio ${marginRatio.toFixed(1)}%. Monitor position closely. Liquidation at $${liquidationPrice.toFixed(2)}.`;
      
      default:
        return `Margin call level: ${level}`;
    }
  }

  // Get all active margin calls
  getActiveMarginCalls() {
    return Array.from(this.marginCalls.values());
  }

  // Get margin call for specific user
  getMarginCallForUser(userId) {
    return this.marginCalls.get(userId) || null;
  }

  // Clear margin call for user (when position closed or margin added)
  clearMarginCall(userId) {
    this.marginCalls.delete(userId);
    this.lastNotificationTime.delete(userId);
  }

  // Configure margin call thresholds
  setThresholds(warning = 150, urgent = 120, critical = 105) {
    this.marginCallThresholds = { warning, urgent, critical };
  }

  // Get current threshold configuration
  getThresholds() {
    return { ...this.marginCallThresholds };
  }

  // Calculate required margin to reach safe level
  calculateRequiredMargin(position, user, currentPrice, targetRatio = 200) {
    if (!this.marginCalculator) return 0;
    
    const maintenanceMargin = this.marginCalculator.calculateMaintenanceMargin(position.size, currentPrice);
    const currentEquity = user.availableBalance + (position.unrealizedPnL || 0);
    const requiredEquity = (maintenanceMargin * targetRatio) / 100;
    const additionalMarginNeeded = Math.max(0, requiredEquity - currentEquity);
    
    return additionalMarginNeeded;
  }

  // Get summary of all margin statuses
  getMarginSummary(positions, users, currentPrice) {
    const summary = {
      totalPositions: positions.size,
      safe: 0,
      warning: 0,
      urgent: 0,
      critical: 0,
      averageMarginRatio: 0
    };
    
    let totalMarginRatio = 0;
    let positionCount = 0;
    
    positions.forEach(position => {
      const user = users.get(position.userId);
      if (!user) return;
      
      const marginStatus = this.calculateMarginStatus(position, user, currentPrice);
      const { marginRatio } = marginStatus;
      
      totalMarginRatio += marginRatio;
      positionCount++;
      
      if (marginRatio <= this.marginCallThresholds.critical) {
        summary.critical++;
      } else if (marginRatio <= this.marginCallThresholds.urgent) {
        summary.urgent++;
      } else if (marginRatio <= this.marginCallThresholds.warning) {
        summary.warning++;
      } else {
        summary.safe++;
      }
    });
    
    summary.averageMarginRatio = positionCount > 0 ? totalMarginRatio / positionCount : 0;
    
    return summary;
  }
}

module.exports = { MarginMonitor }; 