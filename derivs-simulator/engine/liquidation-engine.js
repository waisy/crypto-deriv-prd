const Decimal = require('decimal.js');
const { LiquidationPosition } = require('./position');

class PositionLiquidationEngine {
    constructor() {
        this.positions = []; // Array of liquidation positions
        this.nextPositionId = 1;
        this.positionHistory = []; // Audit trail
    }

    /**
     * Receives a position from liquidation, transferring it at bankruptcy price
     * @param {Object} originalPosition - The user's original position
     * @param {Decimal} bankruptcyPrice - Price at which user gets closed out
     * @param {string} userId - Original position owner
     */
    receivePosition(originalPosition, bankruptcyPrice, userId) {
        console.log('🔄 POSITION LIQUIDATION ENGINE: RECEIVING POSITION');
        console.log('='.repeat(50));
        console.log(`📥 POSITION TRANSFER TO LIQUIDATION ENGINE:`, {
            originalUserId: userId,
            positionSide: originalPosition.side,
            positionSize: originalPosition.size.toString(),
            bankruptcyPrice: bankruptcyPrice.toString(),
            currentPositionsCount: this.positions.length
        });
        
        const liquidationPosition = new LiquidationPosition(originalPosition, bankruptcyPrice, userId, this.nextPositionId++);

        this.positions.push(liquidationPosition);
        
        console.log(`✅ POSITION SUCCESSFULLY TRANSFERRED TO LIQUIDATION ENGINE`);
        console.log(`   New LE position ID: ${liquidationPosition.id}`);
        console.log(`   Total LE positions: ${this.positions.length}`);
        console.log(`   🎯 ZERO-SUM MAINTAINED: Position transferred, not destroyed`);
        
        // Log the transfer for audit trail
        this.positionHistory.push({
            action: 'position_received',
            positionId: liquidationPosition.id,
            originalUserId: userId,
            bankruptcyPrice: bankruptcyPrice.toString(),
            transferTime: liquidationPosition.transferTime,
            position: { ...liquidationPosition }
        });

        console.log('='.repeat(50));
        
        return liquidationPosition;
    }

    /**
     * Calculate unrealized P&L for all liquidation positions
     * @param {Decimal} currentPrice - Current mark price
     */
    calculateUnrealizedPnL(currentPrice) {
        let totalPnL = new Decimal(0);
        
        for (const position of this.positions) {
            const positionPnL = this.calculatePositionPnL(position, currentPrice);
            totalPnL = totalPnL.plus(positionPnL);
        }
        
        return totalPnL;
    }

    /**
     * Calculate P&L for a specific liquidation position
     * @param {LiquidationPosition} position - Liquidation position
     * @param {Decimal} currentPrice - Current mark price
     */
    calculatePositionPnL(position, currentPrice) {
        return position.calculateUnrealizedPnL(currentPrice);
    }

    /**
     * Get positions by status
     * @param {string} status - Status to filter by
     */
    getPositionsByStatus(status) {
        return this.positions.filter(p => p.status === status);
    }

    /**
     * Update position status
     * @param {number} positionId - Position ID
     * @param {string} newStatus - New status
     */
    updatePositionStatus(positionId, newStatus) {
        const position = this.positions.find(p => p.id === positionId);
        if (position) {
            const oldStatus = position.status;
            position.status = newStatus;
            position.lastAttemptTime = Date.now();
            
            this.positionHistory.push({
                action: 'status_change',
                positionId: positionId,
                oldStatus: oldStatus,
                newStatus: newStatus,
                timestamp: position.lastAttemptTime
            });
        }
    }

    /**
     * Remove position after successful closure
     * @param {number} positionId - Position ID
     * @param {string} closureMethod - How it was closed (orderbook/adl)
     * @param {Decimal} closePrice - Price at which it was closed
     */
    removePosition(positionId, closureMethod, closePrice) {
        const positionIndex = this.positions.findIndex(p => p.id === positionId);
        if (positionIndex !== -1) {
            const position = this.positions[positionIndex];
            const realizedPnL = this.calculatePositionPnL(position, closePrice);
            
            // Log closure
            this.positionHistory.push({
                action: 'position_closed',
                positionId: positionId,
                closureMethod: closureMethod,
                closePrice: closePrice.toString(),
                realizedPnL: realizedPnL.toString(),
                timestamp: Date.now(),
                position: { ...position }
            });
            
            // Remove from active positions
            this.positions.splice(positionIndex, 1);
            
            console.log(`Liquidation Engine: Closed position ${positionId} via ${closureMethod} at $${closePrice}, P&L: $${realizedPnL}`);
            
            return {
                position: position,
                realizedPnL: realizedPnL
            };
        }
        return null;
    }

    /**
     * Get summary statistics
     * @param {Decimal} currentPrice - Current mark price
     */
    getSummary(currentPrice) {
        const totalPositions = this.positions.length;
        const totalUnrealizedPnL = this.calculateUnrealizedPnL(currentPrice);
        
        const statusCounts = this.positions.reduce((acc, pos) => {
            acc[pos.status] = (acc[pos.status] || 0) + 1;
            return acc;
        }, {});

        const totalSize = this.positions.reduce((sum, pos) => {
            const size = pos.size instanceof Decimal ? pos.size : new Decimal(pos.size || 0);
            return sum.plus(size);
        }, new Decimal(0));

        return {
            totalPositions,
            totalSize: totalSize.toString(),
            totalUnrealizedPnL: totalUnrealizedPnL.toString(),
            statusCounts,
            oldestPositionTime: totalPositions > 0 
                ? Math.min(...this.positions.map(p => p.transferTime))
                : null
        };
    }

    /**
     * Get all positions with current P&L
     * @param {Decimal} currentPrice - Current mark price
     */
    getPositionsWithPnL(currentPrice) {
        return this.positions.map(position => {
            const unrealizedPnL = this.calculatePositionPnL(position, currentPrice);
            return {
                ...position,
                size: position.size, // Keep as Decimal
                entryPrice: position.entryPrice, // Keep as Decimal
                unrealizedPnL, // Keep as Decimal
                timeSinceTransfer: Date.now() - position.transferTime
            };
        });
    }

    /**
     * Check if liquidation engine can cover positions with insurance fund
     * @param {Decimal} currentPrice - Current mark price
     * @param {Decimal} insuranceFundBalance - Available insurance fund
     */
    checkInsuranceFundSufficiency(currentPrice, insuranceFundBalance) {
        const totalUnrealizedPnL = this.calculateUnrealizedPnL(currentPrice);
        const exposure = totalUnrealizedPnL.isNegative() ? totalUnrealizedPnL.abs() : new Decimal(0);
        
        return {
            isSufficient: insuranceFundBalance.gte(exposure),
            exposure: exposure.toString(),
            available: insuranceFundBalance.toString(),
            shortfall: exposure.gt(insuranceFundBalance) ? exposure.minus(insuranceFundBalance).toString() : '0'
        };
    }

    /**
     * Verify zero-sum invariant including liquidation positions
     * @param {Array} userPositions - All user positions
     */
    verifyZeroSum(userPositions) {
        // Calculate user position totals
        let userLongs = new Decimal(0);
        let userShorts = new Decimal(0);
        
        for (const position of userPositions) {
            const size = position.size instanceof Decimal ? position.size : new Decimal(position.size || 0);
            if (position.side === 'long') {
                userLongs = userLongs.plus(size);
            } else {
                userShorts = userShorts.plus(size);
            }
        }

        // Calculate liquidation engine totals
        let leLongs = new Decimal(0);
        let leShorts = new Decimal(0);
        
        for (const position of this.positions) {
            const size = position.size instanceof Decimal ? position.size : new Decimal(position.size || 0);
            if (position.side === 'long') {
                leLongs = leLongs.plus(size);
            } else {
                leShorts = leShorts.plus(size);
            }
        }

        const totalLongs = userLongs.plus(leLongs);
        const totalShorts = userShorts.plus(leShorts);
        const difference = totalLongs.minus(totalShorts);

        return {
            isBalanced: difference.abs().lt(0.00000001), // Allow for tiny rounding errors
            userLongs: userLongs.toString(),
            userShorts: userShorts.toString(),
            leLongs: leLongs.toString(),
            leShorts: leShorts.toString(),
            totalLongs: totalLongs.toString(),
            totalShorts: totalShorts.toString(),
            difference: difference.toString()
        };
    }
}

module.exports = PositionLiquidationEngine; 