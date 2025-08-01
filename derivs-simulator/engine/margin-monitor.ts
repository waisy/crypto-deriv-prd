import { Decimal } from 'decimal.js';
import { MarginCalculator, PositionForMargin } from './margin';
import { User } from './user';

export type MarginCallLevel = 'WARNING' | 'URGENT' | 'CRITICAL';

export interface MarginCallThresholds {
  warning: number;
  urgent: number;
  critical: number;
}

export interface MarginStatus {
  marginRatio: Decimal;
  equity: Decimal;
  maintenanceMargin: Decimal;
  liquidationPrice: Decimal;
  distanceToLiquidation: number;
  distancePercentage: number;
  isAtRisk: boolean;
}

export interface MarginCall {
  userId: string;
  positionId: string;
  level: MarginCallLevel;
  marginRatio: Decimal;
  liquidationPrice: Decimal;
  distanceToLiquidation: number;
  distancePercentage: number;
  maintenanceMargin: Decimal;
  equity: Decimal;
  shouldNotify: boolean;
  timestamp: number;
  message: string;
}

export interface MarginSummary {
  totalPositions: number;
  safe: number;
  warning: number;
  urgent: number;
  critical: number;
  averageMarginRatio: number;
}

export interface PositionForMonitoring {
  userId: string;
  side: 'long' | 'short';
  size: Decimal;
  avgEntryPrice: Decimal;
  leverage: Decimal;
  initialMargin: Decimal;
  unrealizedPnL?: Decimal;
}

export class MarginMonitor {
  public marginCalculator: MarginCalculator | null;
  public marginCallThresholds: MarginCallThresholds;
  public marginCalls: Map<string, MarginCall>;
  public lastNotificationTime: Map<string, number>;
  public notificationCooldown: number;

  constructor(marginCalculator: MarginCalculator | null = null) {
    this.marginCalculator = marginCalculator;
    this.marginCallThresholds = {
      warning: 150,   // 150% margin ratio - warning level
      urgent: 120,    // 120% margin ratio - urgent warning
      critical: 105   // 105% margin ratio - critical warning (liquidation imminent)
    };
    this.marginCalls = new Map<string, MarginCall>();
    this.lastNotificationTime = new Map<string, number>();
    this.notificationCooldown = 30000; // 30 seconds between notifications
  }

  // Monitor all positions and generate margin calls
  monitorPositions(positions: Map<string, PositionForMonitoring>, users: Map<string, User>, currentPrice: Decimal): MarginCall[] {
    const marginCallUpdates: MarginCall[] = [];
    
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
  calculateMarginStatus(position: PositionForMonitoring, user: User, currentPrice: Decimal): MarginStatus {
    if (!this.marginCalculator) {
      throw new Error('MarginCalculator not available');
    }
    
    // Create a position object that satisfies PositionForMargin interface
    const unrealizedPnL = position.unrealizedPnL || new Decimal(0);
    const positionForMargin: PositionForMargin = {
      ...position,
      unrealizedPnL: unrealizedPnL
    };
    
    const maintenanceMargin = this.marginCalculator.calculateMaintenanceMargin(position.size, currentPrice);
    const liquidationPrice = this.marginCalculator.calculateLiquidationPrice(positionForMargin);
    
    // Calculate equity (available balance + unrealized PnL)
    const equity = user.availableBalance.plus(unrealizedPnL);
    
    // Calculate margin ratio
    const marginRatio = this.marginCalculator.calculateMarginRatio(positionForMargin, user.availableBalance, currentPrice, user.usedMargin) || new Decimal(0);
    
    // Calculate distance to liquidation
    const distanceToLiquidation = liquidationPrice.minus(currentPrice).abs().toNumber();
    const distancePercentage = liquidationPrice.minus(currentPrice).abs().dividedBy(currentPrice).times(100).toNumber();
    
    return {
      marginRatio,
      equity,
      maintenanceMargin,
      liquidationPrice,
      distanceToLiquidation,
      distancePercentage,
      isAtRisk: marginRatio.lessThanOrEqualTo(this.marginCallThresholds.critical)
    };
  }

  // Check if position needs a margin call
  checkMarginCall(position: PositionForMonitoring, marginStatus: MarginStatus): MarginCall | null {
    const { marginRatio } = marginStatus;
    const userId = position.userId;
    const marginRatioNum = marginRatio.toNumber();
    
    // Determine margin call level
    let level: MarginCallLevel | null = null;
    if (marginRatioNum <= this.marginCallThresholds.critical) {
      level = 'CRITICAL';
    } else if (marginRatioNum <= this.marginCallThresholds.urgent) {
      level = 'URGENT';
    } else if (marginRatioNum <= this.marginCallThresholds.warning) {
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
  generateMarginCallMessage(level: MarginCallLevel, marginStatus: MarginStatus): string {
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
  getActiveMarginCalls(): MarginCall[] {
    return Array.from(this.marginCalls.values());
  }

  // Get margin call for specific user
  getMarginCallForUser(userId: string): MarginCall | null {
    return this.marginCalls.get(userId) || null;
  }

  // Clear margin call for user (when position closed or margin added)
  clearMarginCall(userId: string): void {
    this.marginCalls.delete(userId);
    this.lastNotificationTime.delete(userId);
  }

  // Configure margin call thresholds
  setThresholds(warning: number = 150, urgent: number = 120, critical: number = 105): void {
    this.marginCallThresholds = { warning, urgent, critical };
  }

  // Get current threshold configuration
  getThresholds(): MarginCallThresholds {
    return { ...this.marginCallThresholds };
  }

  // Calculate required margin to reach safe level
  calculateRequiredMargin(position: PositionForMonitoring, user: User, currentPrice: Decimal, targetRatio: number = 200): number {
    if (!this.marginCalculator) return 0;
    
    const maintenanceMargin = this.marginCalculator.calculateMaintenanceMargin(position.size, currentPrice);
    const unrealizedPnL = position.unrealizedPnL || new Decimal(0);
    const currentEquity = user.availableBalance.plus(unrealizedPnL);
    const requiredEquity = maintenanceMargin.times(targetRatio).dividedBy(100);
    const additionalMarginNeeded = Decimal.max(0, requiredEquity.minus(currentEquity));
    
    return additionalMarginNeeded.toNumber();
  }

  // Get summary of all margin statuses
  getMarginSummary(positions: Map<string, PositionForMonitoring>, users: Map<string, User>, currentPrice: Decimal): MarginSummary {
    const summary: MarginSummary = {
      totalPositions: positions.size,
      safe: 0,
      warning: 0,
      urgent: 0,
      critical: 0,
      averageMarginRatio: 0
    };
    
    let totalMarginRatio = new Decimal(0);
    let positionCount = 0;
    
    positions.forEach(position => {
      const user = users.get(position.userId);
      if (!user) return;
      
      const marginStatus = this.calculateMarginStatus(position, user, currentPrice);
      const { marginRatio } = marginStatus;
      const marginRatioNum = marginRatio.toNumber();
      
      totalMarginRatio = totalMarginRatio.plus(marginRatio);
      positionCount++;
      
      if (marginRatioNum <= this.marginCallThresholds.critical) {
        summary.critical++;
      } else if (marginRatioNum <= this.marginCallThresholds.urgent) {
        summary.urgent++;
      } else if (marginRatioNum <= this.marginCallThresholds.warning) {
        summary.warning++;
      } else {
        summary.safe++;
      }
    });
    
    summary.averageMarginRatio = positionCount > 0 ? totalMarginRatio.dividedBy(positionCount).toNumber() : 0;
    
    return summary;
  }
} 