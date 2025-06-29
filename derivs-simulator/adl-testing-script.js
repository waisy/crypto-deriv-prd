const WebSocket = require('ws');
const http = require('http'); // For API calls

class ADLTester {
  constructor() {
    this.ws = null;
    this.clientId = Math.random().toString(36).substr(2, 8);
    this.testResults = [];
    this.financialSnapshots = {}; // Track financial states throughout test
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3000');
      
      this.ws.on('open', () => {
        console.log('🔗 Connected to server');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Error parsing message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      });
    });
  }

  handleMessage(message) {
    if (message.type === 'update') {
      // Capture snapshots at key moments
      if (message.state.positions && message.state.positions.length === 2 && !this.financialSnapshots['after_positions']) {
        this.captureFinancialSnapshot('after_positions', message.state);
      }
      
      if (message.state.positions && message.state.positions.length === 1 && message.state.positionLiquidationEngine && message.state.positionLiquidationEngine.positions.length === 1 && !this.financialSnapshots['after_liquidation']) {
        this.captureFinancialSnapshot('after_liquidation', message.state);
      }
      
      if ((!message.state.positions || message.state.positions.length === 0) && (!message.state.positionLiquidationEngine || message.state.positionLiquidationEngine.positions.length === 0) && !this.financialSnapshots['after_adl']) {
        this.captureFinancialSnapshot('after_adl', message.state);
      }
      
      this.logState(message.state);
      this.checkMarginAnomalies(message.state);
    } else {
      console.log('📨 Received:', message.type, message.success ? '✅' : '❌');
    }
  }

  checkMarginAnomalies(state) {
    console.log('\n🔍 COMPREHENSIVE FINANCIAL VALIDATION:');
    let hasAnomalies = false;
    
    if (!state.users || state.users.length === 0) {
      console.log('  ⚠️  No user data available for financial validation');
      return false;
    }
    
    state.users.forEach(user => {
      const userId = user.userId || user.id;
      if (!user || !userId) {
        console.log('  ⚠️  Invalid user data in financial validation:', user);
        return;
      }
      
      const position = state.positions.find(p => p.userId === userId);
      const usedMargin = parseFloat(user.usedMargin || 0);
      const availableBalance = parseFloat(user.availableBalance || 0);
      const totalBalance = parseFloat(user.totalBalance || user.balance || 0);
      const equity = parseFloat(user.equity || 0);
      const unrealizedPnL = parseFloat(user.unrealizedPnL || 0);
      const totalPnL = parseFloat(user.totalPnL || 0);
      
      console.log(`\n  👤 ${userId.toUpperCase()} FINANCIAL AUDIT:`);
      
      // 1. Check for used margin without position
      if (usedMargin > 0.01 && !position) {
        console.log(`    🚨 MARGIN LEAK: Has used margin $${usedMargin} but no position!`);
        hasAnomalies = true;
      }
      
      // 2. Check if balance components add up
      const calculatedTotal = availableBalance + usedMargin;
      if (Math.abs(calculatedTotal - totalBalance) > 0.01) {
        console.log(`    🚨 BALANCE MISMATCH: Available($${availableBalance}) + Used($${usedMargin}) = $${calculatedTotal} ≠ Total($${totalBalance})`);
        hasAnomalies = true;
      }
      
      // 3. Check if position exists but no used margin
      if (position && usedMargin < 0.01) {
        console.log(`    🚨 MISSING MARGIN: Has position but no used margin!`);
        hasAnomalies = true;
      }
      
      // 4. Check equity calculation
      const calculatedEquity = totalBalance + unrealizedPnL;
      if (Math.abs(calculatedEquity - equity) > 0.01 && equity > 0) {
        console.log(`    🚨 EQUITY ERROR: Balance($${totalBalance}) + UnrealizedPnL($${unrealizedPnL}) = $${calculatedEquity} ≠ Equity($${equity})`);
        hasAnomalies = true;
      }
      
      // 5. Check position PnL consistency
      if (position) {
        const positionPnL = parseFloat(position.unrealizedPnL);
        if (Math.abs(positionPnL - unrealizedPnL) > 0.01) {
          console.log(`    🚨 PNL INCONSISTENCY: Position PnL($${positionPnL}) ≠ User PnL($${unrealizedPnL})`);
          hasAnomalies = true;
        }
        
        // Check if margin matches position requirements
        const expectedMargin = parseFloat(position.initialMargin);
        if (Math.abs(usedMargin - expectedMargin) > 0.01) {
          console.log(`    🚨 MARGIN MISMATCH: Used margin($${usedMargin}) ≠ Position margin($${expectedMargin})`);
          hasAnomalies = true;
        }
      }
      
      // 6. Validate liquidated users have zero margin
      if (!position && Math.abs(totalBalance - 100000) < 0.01 && usedMargin > 0.01) {
        console.log(`    🚨 LIQUIDATION MARGIN BUG: Liquidated user still has used margin $${usedMargin}`);
        hasAnomalies = true;
      }
      
      // 7. Check for negative balances
      if (availableBalance < -0.01) {
        console.log(`    🚨 NEGATIVE BALANCE: Available balance is negative: $${availableBalance}`);
        hasAnomalies = true;
      }
      
      if (!hasAnomalies) {
        console.log(`    ✅ ${userId}: All financial checks passed`);
      }
    });
    
    // 8. System-wide checks
    const totalSystemBalance = state.users.reduce((sum, user) => {
      return sum + parseFloat(user.totalBalance || user.balance || 0);
    }, 0);
    
    const totalSystemEquity = state.users.reduce((sum, user) => {
      return sum + parseFloat(user.equity || user.totalBalance || user.balance || 0);
    }, 0);
    
    console.log(`\n  📊 SYSTEM-WIDE FINANCIAL SUMMARY:`);
    console.log(`    💰 Total System Balance: $${totalSystemBalance.toFixed(2)}`);
    console.log(`    💼 Total System Equity: $${totalSystemEquity.toFixed(2)}`);
    
    // Check if system lost money (excluding insurance fund payouts)
    const expectedSystemBalance = state.users.length * 100000; // Each user started with $100k
    if (Math.abs(totalSystemBalance - expectedSystemBalance) > 0.01) {
      console.log(`    🚨 SYSTEM BALANCE DRIFT: Expected $${expectedSystemBalance}, Got $${totalSystemBalance.toFixed(2)}`);
      hasAnomalies = true;
    }
    
    if (!hasAnomalies) {
      console.log('  ✅ All financial validations passed');
    }
    
    return hasAnomalies;
  }

  trackFinancialState(label, state) {
    console.log(`\n📈 FINANCIAL STATE TRACKING: ${label}`);
    if (!state.users) return;
    
    state.users.forEach(user => {
      const userId = user.userId || user.id;
      const position = state.positions.find(p => p.userId === userId);
      const balance = parseFloat(user.totalBalance || user.balance || 0);
      const available = parseFloat(user.availableBalance || 0);
      const usedMargin = parseFloat(user.usedMargin || 0);
      const unrealizedPnL = parseFloat(user.unrealizedPnL || 0);
      const equity = balance + unrealizedPnL;
      
      console.log(`  ${userId}: Balance=$${balance}, Available=$${available}, Margin=$${usedMargin}, PnL=$${unrealizedPnL.toFixed(2)}, Equity=$${equity.toFixed(2)}, Position=${position ? `${position.side} ${position.size}` : 'None'}`);
    });
    
    if (state.insuranceFund) {
      const fundBalance = parseFloat(state.insuranceFund.balance);
      const fundChange = fundBalance - 1000000;
      console.log(`  Insurance Fund: $${fundBalance.toFixed(2)} (${fundChange >= 0 ? '+' : ''}$${fundChange.toFixed(2)})`);
    }
  }

  logState(state) {
    console.log('\n📊 CURRENT STATE:');
    console.log('Mark Price:', state.markPrice);
    
    console.log('\n👥 USER ACCOUNTS & COMPREHENSIVE FINANCIALS:');
    if (state.users && state.users.length > 0) {
      state.users.forEach(user => {
        // Handle both userId and id fields for compatibility
        const userId = user.userId || user.id;
        if (!user || !userId) {
          console.log('  ⚠️  Invalid user data:', user);
          return;
        }
        
        const position = state.positions.find(p => p.userId === userId);
        
        console.log(`\n  👤 ${userId.toUpperCase()}:`);
        console.log(`    💰 Balance: $${user.totalBalance || user.balance} (Available: $${user.availableBalance}, Used Margin: $${user.usedMargin})`);
        console.log(`    📊 Equity: $${user.equity || 'N/A'} | Margin Ratio: ${user.marginRatio || 'N/A'}%`);
        console.log(`    💼 Total PnL: $${user.totalPnL || 0} | Unrealized PnL: $${user.unrealizedPnL || 0}`);
        
        if (position) {
          console.log(`    📈 Position: ${position.side} ${position.size} BTC @ $${position.avgEntryPrice}`);
          console.log(`    💵 Position PnL: $${position.unrealizedPnL} | Liq Price: $${position.liquidationPrice}`);
          console.log(`    🔒 Margins - Initial: $${position.initialMargin}, Maintenance: $${position.maintenanceMargin}`);
          console.log(`    ⚖️  Position Equity: $${(parseFloat(user.availableBalance) + parseFloat(position.unrealizedPnL)).toFixed(2)}`);
        } else {
          console.log(`    📈 Position: None`);
        }
        
        // Financial validation checks
        const balance = parseFloat(user.totalBalance || user.balance || 0);
        const available = parseFloat(user.availableBalance || 0);
        const usedMargin = parseFloat(user.usedMargin || 0);
        const equity = parseFloat(user.equity || 0);
        const unrealizedPnL = parseFloat(user.unrealizedPnL || 0);
        
        // Check balance components
        const calculatedTotal = available + usedMargin;
        if (Math.abs(calculatedTotal - balance) > 0.01) {
          console.log(`    🚨 BALANCE ERROR: Available($${available}) + Used($${usedMargin}) = $${calculatedTotal} ≠ Total($${balance})`);
        }
        
        // Check equity calculation
        const calculatedEquity = balance + unrealizedPnL;
        if (Math.abs(calculatedEquity - equity) > 0.01 && equity > 0) {
          console.log(`    🚨 EQUITY ERROR: Balance($${balance}) + UnrealizedPnL($${unrealizedPnL}) = $${calculatedEquity} ≠ Equity($${equity})`);
        }
        
        // Flag margin issues
        if (usedMargin > 0.01 && !position) {
          console.log(`    🚨 MARGIN BUG: Used margin $${usedMargin} but no position!`);
        }
        
        // Check if position PnL matches user PnL
        if (position && Math.abs(parseFloat(position.unrealizedPnL) - unrealizedPnL) > 0.01) {
          console.log(`    🚨 PNL MISMATCH: Position PnL($${position.unrealizedPnL}) ≠ User PnL($${unrealizedPnL})`);
        }
      });
    } else {
      console.log('  No user data available');
    }

    console.log('\n🏭 LIQUIDATION ENGINE POSITIONS:');
    if (state.positionLiquidationEngine && state.positionLiquidationEngine.positions && state.positionLiquidationEngine.positions.length > 0) {
      state.positionLiquidationEngine.positions.forEach(pos => {
        console.log(`  LE Position ${pos.id}: ${pos.side} ${pos.size} @ ${pos.entryPrice} (Original: ${pos.originalUserId}, PnL: ${pos.unrealizedPnL})`);
        console.log(`    📊 Status: ${pos.status} | Bankruptcy Price: ${pos.bankruptcyPrice || 'N/A'}`);
      });
    } else {
      console.log('  No liquidation positions');
    }

    // Enhanced zero-sum check with detailed breakdown
    let userLong = 0, userShort = 0, leLong = 0, leShort = 0;
    let userPnL = 0, lePnL = 0;
    let totalUserEquity = 0;
    
    state.positions.forEach(pos => {
      if (pos.side === 'long') {
        userLong += parseFloat(pos.size);
        userPnL += parseFloat(pos.unrealizedPnL);
      }
      if (pos.side === 'short') {
        userShort += parseFloat(pos.size);
        userPnL += parseFloat(pos.unrealizedPnL);
      }
    });

    if (state.positionLiquidationEngine && state.positionLiquidationEngine.positions) {
      state.positionLiquidationEngine.positions.forEach(pos => {
        if (pos.side === 'long') {
          leLong += parseFloat(pos.size);
          lePnL += parseFloat(pos.unrealizedPnL || 0);
        }
        if (pos.side === 'short') {
          leShort += parseFloat(pos.size);
          lePnL += parseFloat(pos.unrealizedPnL || 0);
        }
      });
    }

    // Calculate total system equity
    if (state.users) {
      state.users.forEach(user => {
        totalUserEquity += parseFloat(user.equity || user.totalBalance || user.balance || 0);
      });
    }

    const totalLong = userLong + leLong;
    const totalShort = userShort + leShort;
    const totalPnL = userPnL + lePnL;

    console.log(`\n⚖️  COMPREHENSIVE ZERO-SUM ANALYSIS:`);
    console.log(`  📊 Quantities: User(L:${userLong}, S:${userShort}) + LE(L:${leLong}, S:${leShort}) = Total(L:${totalLong}, S:${totalShort})`);
    console.log(`  💰 PnL: User($${userPnL.toFixed(2)}) + LE($${lePnL.toFixed(2)}) = Total($${totalPnL.toFixed(2)})`);
    console.log(`  💼 Total System Equity: $${totalUserEquity.toFixed(2)}`);
    console.log(`  🎯 Position Diff: ${(totalLong - totalShort).toFixed(6)}, PnL Diff: $${totalPnL.toFixed(2)}`);
    
    if (Math.abs(totalLong - totalShort) > 0.001) {
      console.log('  🚨 ZERO-SUM VIOLATION: Position quantities do not balance!');
    }
    if (Math.abs(totalPnL) > 0.01) {
      console.log('  🚨 ZERO-SUM VIOLATION: PnL does not sum to zero!');
    }
    if (Math.abs(totalLong - totalShort) <= 0.001 && Math.abs(totalPnL) <= 0.01) {
      console.log('  ✅ Zero-sum invariant maintained');
    }

    // Insurance fund info with context
    if (state.insuranceFund) {
      const fundBalance = parseFloat(state.insuranceFund.balance);
      const fundChange = fundBalance - 1000000; // Initial fund was $1M
      console.log(`\n🏛️  Insurance Fund: $${fundBalance.toFixed(2)} (Change: ${fundChange >= 0 ? '+' : ''}$${fundChange.toFixed(2)}, At Risk: ${state.insuranceFund.isAtRisk})`);
    }
  }

  async sendMessage(message) {
    return new Promise((resolve) => {
      message.clientId = this.clientId;
      this.ws.send(JSON.stringify(message));
      setTimeout(resolve, 1000); // Wait for processing
    });
  }

  async runTest() {
    try {
      console.log('🧪 Starting ADL Test\n');

      // Step 1: Create opposing positions
      console.log('📝 Step 1: Creating positions...');
      
      await this.sendMessage({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      await this.sendMessage({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      console.log('\n📈 Step 2: Moving mark price to create profit for bob...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 50000
      });

      console.log('\n💥 Step 3: Moving mark price to liquidate eve...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 54000 // Should trigger liquidation for eve's short position
      });

      console.log('\n🎯 Step 4: Executing ADL...');
      await this.sendMessage({
        type: 'liquidation_step',
        method: 'adl'
      });

      console.log('\n🏁 Step 5: Final financial audit...');
      // Give the system a moment to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Perform comprehensive financial analysis
      if (this.financialSnapshots['after_positions'] && this.financialSnapshots['after_liquidation']) {
        this.compareFinancialSnapshots('after_positions', 'after_liquidation');
        this.validateBalanceConservation('after_positions', 'after_liquidation');
      }
      
      if (this.financialSnapshots['after_liquidation'] && this.financialSnapshots['after_adl']) {
        this.compareFinancialSnapshots('after_liquidation', 'after_adl');
        this.validateBalanceConservation('after_liquidation', 'after_adl');
      }
      
      if (this.financialSnapshots['after_positions'] && this.financialSnapshots['after_liquidation'] && this.financialSnapshots['after_adl']) {
        this.validateLiquidationAccounting('after_positions', 'after_liquidation', 'after_adl');
        this.validateBalanceConservation('after_positions', 'after_adl');
      }

      console.log('\n✅ Regular Test completed');
      
      // Run the zero insurance fund test
      console.log('\n' + '='.repeat(60));
      console.log('🔄 RUNNING ZERO INSURANCE FUND TEST');
      console.log('='.repeat(60));
      
      // Clear snapshots for new test
      this.financialSnapshots = {};
      
      await this.runZeroInsuranceFundTest();

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      this.ws.close();
    }
  }

  captureFinancialSnapshot(label, state) {
    if (!state.users) return;
    
    this.financialSnapshots[label] = {
      timestamp: Date.now(),
      users: state.users.map(user => ({
        userId: user.userId || user.id,
        balance: parseFloat(user.totalBalance || user.balance || 0),
        available: parseFloat(user.availableBalance || 0),
        usedMargin: parseFloat(user.usedMargin || 0),
        unrealizedPnL: parseFloat(user.unrealizedPnL || 0),
        equity: parseFloat(user.equity || 0),
        hasPosition: !!state.positions.find(p => p.userId === (user.userId || user.id))
      })),
      insuranceFund: state.insuranceFund ? parseFloat(state.insuranceFund.balance) : 0,
      totalPositions: state.positions ? state.positions.length : 0,
      liquidationPositions: state.positionLiquidationEngine ? state.positionLiquidationEngine.positions.length : 0,
      totalSystemBalance: null // Will be calculated
    };
    
    // Calculate total system balance (users + insurance fund)
    const totalUserBalances = this.financialSnapshots[label].users.reduce((sum, user) => sum + user.balance, 0);
    this.financialSnapshots[label].totalSystemBalance = totalUserBalances + this.financialSnapshots[label].insuranceFund;
    
    console.log(`\n📸 FINANCIAL SNAPSHOT: ${label}`);
    this.financialSnapshots[label].users.forEach(user => {
      console.log(`  ${user.userId}: Balance=$${user.balance}, Available=$${user.available}, Margin=$${user.usedMargin}, Equity=$${user.equity.toFixed(2)}, Position=${user.hasPosition ? 'Yes' : 'No'}`);
    });
    console.log(`  💰 Total System Balance: $${this.financialSnapshots[label].totalSystemBalance.toFixed(2)} (Users: $${totalUserBalances.toFixed(2)} + IF: $${this.financialSnapshots[label].insuranceFund.toFixed(2)})`);
  }

  compareFinancialSnapshots(beforeLabel, afterLabel) {
    const before = this.financialSnapshots[beforeLabel];
    const after = this.financialSnapshots[afterLabel];
    
    if (!before || !after) {
      console.log(`\n⚠️  Cannot compare snapshots: ${beforeLabel} or ${afterLabel} missing`);
      return;
    }
    
    console.log(`\n🔍 FINANCIAL CHANGE ANALYSIS: ${beforeLabel} → ${afterLabel}`);
    
    before.users.forEach(beforeUser => {
      const afterUser = after.users.find(u => u.userId === beforeUser.userId);
      if (!afterUser) return;
      
      const balanceChange = afterUser.balance - beforeUser.balance;
      const availableChange = afterUser.available - beforeUser.available;
      const marginChange = afterUser.usedMargin - beforeUser.usedMargin;
      const pnlChange = afterUser.unrealizedPnL - beforeUser.unrealizedPnL;
      
      console.log(`\n  👤 ${beforeUser.userId.toUpperCase()} CHANGES:`);
      console.log(`    💰 Balance: ${beforeUser.balance} → ${afterUser.balance} (${balanceChange >= 0 ? '+' : ''}${balanceChange.toFixed(2)})`);
      console.log(`    💳 Available: ${beforeUser.available} → ${afterUser.available} (${availableChange >= 0 ? '+' : ''}${availableChange.toFixed(2)})`);
      console.log(`    🔒 Margin: ${beforeUser.usedMargin} → ${afterUser.usedMargin} (${marginChange >= 0 ? '+' : ''}${marginChange.toFixed(2)})`);
      console.log(`    📊 PnL: ${beforeUser.unrealizedPnL.toFixed(2)} → ${afterUser.unrealizedPnL.toFixed(2)} (${pnlChange >= 0 ? '+' : ''}${pnlChange.toFixed(2)})`);
      console.log(`    📈 Position: ${beforeUser.hasPosition ? 'Yes' : 'No'} → ${afterUser.hasPosition ? 'Yes' : 'No'}`);
      
      // Flag significant changes
      if (Math.abs(balanceChange) > 0.01) {
        console.log(`    ${balanceChange > 0 ? '📈' : '📉'} Balance changed by $${Math.abs(balanceChange).toFixed(2)}`);
      }
      
      if (beforeUser.hasPosition && !afterUser.hasPosition) {
        console.log(`    🔥 Position was liquidated`);
        if (marginChange !== -beforeUser.usedMargin) {
          console.log(`    🚨 MARGIN ERROR: Expected margin release of $${beforeUser.usedMargin}, got ${-marginChange.toFixed(2)}`);
        } else {
          console.log(`    ✅ Margin correctly released: $${beforeUser.usedMargin}`);
        }
      }
    });
    
    const fundChange = after.insuranceFund - before.insuranceFund;
    console.log(`\n  🏛️  Insurance Fund: ${before.insuranceFund.toFixed(2)} → ${after.insuranceFund.toFixed(2)} (${fundChange >= 0 ? '+' : ''}${fundChange.toFixed(2)})`);
  }

  validateLiquidationAccounting(preLiquidationLabel, postLiquidationLabel, postADLLabel) {
    console.log(`\n🔬 LIQUIDATION ACCOUNTING VALIDATION`);
    
    const pre = this.financialSnapshots[preLiquidationLabel];
    const post = this.financialSnapshots[postLiquidationLabel];
    const adl = this.financialSnapshots[postADLLabel];
    
    if (!pre || !post || !adl) {
      console.log('⚠️  Missing snapshots for liquidation validation');
      return;
    }
    
    // Find the liquidated user
    const liquidatedUser = pre.users.find(user => {
      const afterUser = post.users.find(u => u.userId === user.userId);
      return user.hasPosition && afterUser && !afterUser.hasPosition;
    });
    
    if (!liquidatedUser) {
      console.log('⚠️  No liquidated user found');
      return;
    }
    
    const liquidatedUserPost = post.users.find(u => u.userId === liquidatedUser.userId);
    const liquidatedUserADL = adl.users.find(u => u.userId === liquidatedUser.userId);
    
    console.log(`\n📋 LIQUIDATED USER (${liquidatedUser.userId.toUpperCase()}) ACCOUNTING:`);
    
    // 1. Check margin was released
    const expectedMarginRelease = liquidatedUser.usedMargin;
    const actualMarginRelease = liquidatedUser.usedMargin - liquidatedUserPost.usedMargin;
    console.log(`  🔒 Margin Release: Expected $${expectedMarginRelease}, Actual $${actualMarginRelease}`);
    if (Math.abs(expectedMarginRelease - actualMarginRelease) > 0.01) {
      console.log(`  🚨 MARGIN RELEASE ERROR!`);
    } else {
      console.log(`  ✅ Margin correctly released`);
    }
    
    // 2. Check available balance increased by margin amount
    const availableIncrease = liquidatedUserPost.available - liquidatedUser.available;
    console.log(`  💳 Available Balance Increase: $${availableIncrease} (should equal margin release)`);
    if (Math.abs(availableIncrease - expectedMarginRelease) > 0.01) {
      console.log(`  🚨 AVAILABLE BALANCE ERROR!`);
    } else {
      console.log(`  ✅ Available balance correctly increased`);
    }
    
    // 3. Check total balance consistency
    const totalBalanceChange = liquidatedUserPost.balance - liquidatedUser.balance;
    console.log(`  💰 Total Balance Change: $${totalBalanceChange.toFixed(2)} (should be 0 for proper liquidation)`);
    if (Math.abs(totalBalanceChange) > 0.01) {
      console.log(`  🚨 TOTAL BALANCE ERROR!`);
    } else {
      console.log(`  ✅ Total balance preserved`);
    }
    
    // 4. Check unrealized PnL was cleared
    console.log(`  📊 Unrealized PnL: ${liquidatedUser.unrealizedPnL.toFixed(2)} → ${liquidatedUserPost.unrealizedPnL.toFixed(2)} (should be 0)`);
    if (Math.abs(liquidatedUserPost.unrealizedPnL) > 0.01) {
      console.log(`  🚨 PNL NOT CLEARED!`);
    } else {
      console.log(`  ✅ Unrealized PnL correctly cleared`);
    }
    
    // 5. Check state remains consistent through ADL
    console.log(`\n📋 POST-ADL CONSISTENCY CHECK:`);
    if (liquidatedUserADL.usedMargin !== liquidatedUserPost.usedMargin) {
      console.log(`  🚨 ADL changed liquidated user's margin: ${liquidatedUserPost.usedMargin} → ${liquidatedUserADL.usedMargin}`);
    } else {
      console.log(`  ✅ Liquidated user's margin unchanged through ADL`);
    }
  }

  async resetInsuranceFund() {
    console.log('\n💀 RESETTING INSURANCE FUND TO ZERO...');
    
    // Drain the full $1M fund to zero (assuming default startup balance)
    const amountToDrain = -1000000; 
    console.log(`Draining $1,000,000 from insurance fund...`);
    
    // Use the manual adjustment to drain the fund
    const postData = JSON.stringify({
      amount: amountToDrain,
      description: 'Test scenario: Reset fund to zero for ADL testing'
    });
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/insurance-fund/adjust',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(responseData));
              } catch (e) {
                reject(new Error(`Failed to parse response: ${e.message}`));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
            }
          });
        });
        
        req.on('error', (err) => {
          reject(err);
        });
        
        req.write(postData);
        req.end();
      });
      
      console.log(`✅ Insurance Fund reset to: $${result.newBalance}`);
      
      // Wait for the state update
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`⚠️  Warning: Could not reset insurance fund via API: ${error.message}`);
      console.log(`🔄 Continuing with test anyway...`);
    }
  }

  async runZeroInsuranceFundTest() {
    try {
      console.log('\n🧪 Starting ZERO INSURANCE FUND ADL Test');
      console.log('=' .repeat(50));
      console.log('🎯 Testing ADL behavior when Insurance Fund cannot cover shortfalls');
      
      // Reset fund to zero first
      await this.resetInsuranceFund();

      console.log('\n📝 Step 1: Creating positions...');
      
      await this.sendMessage({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      await this.sendMessage({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      console.log('\n📈 Step 2: Moving mark price to create profit for bob...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 50000
      });

      console.log('\n💥 Step 3: Moving mark price to liquidate eve (IF=0, ADL must handle shortfall)...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 54000 // Should trigger liquidation for eve's short position
      });

      console.log('\n🎯 Step 4: Executing ADL (should socialize eve\'s beyond-margin losses to bob)...');
      await this.sendMessage({
        type: 'liquidation_step',
        method: 'adl'
      });

      console.log('\n🏁 Step 5: Analyzing isolated margin behavior...');
      // Give the system a moment to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Perform financial analysis with zero insurance fund context
      if (this.financialSnapshots['after_positions'] && this.financialSnapshots['after_liquidation']) {
        this.compareFinancialSnapshots('after_positions', 'after_liquidation');
        this.validateBalanceConservation('after_positions', 'after_liquidation');
      }
      
      if (this.financialSnapshots['after_liquidation'] && this.financialSnapshots['after_adl']) {
        this.compareFinancialSnapshots('after_liquidation', 'after_adl');
        this.validateBalanceConservation('after_liquidation', 'after_adl');
      }
      
      if (this.financialSnapshots['after_positions'] && this.financialSnapshots['after_liquidation'] && this.financialSnapshots['after_adl']) {
        this.validateIsolatedMarginAccounting('after_positions', 'after_liquidation', 'after_adl');
        this.validateBalanceConservation('after_positions', 'after_adl');
      }

      console.log('\n✅ Zero Insurance Fund Test completed');
      
    } catch (error) {
      console.error('❌ Zero Insurance Fund Test failed:', error);
      throw error;
    }
  }

  validateIsolatedMarginAccounting(preLiquidationLabel, postLiquidationLabel, postADLLabel) {
    console.log(`\n🔬 ISOLATED MARGIN ACCOUNTING VALIDATION (Zero IF)`);
    
    const pre = this.financialSnapshots[preLiquidationLabel];
    const post = this.financialSnapshots[postLiquidationLabel];
    const adl = this.financialSnapshots[postADLLabel];
    
    if (!pre || !post || !adl) {
      console.log('⚠️  Missing snapshots for isolated margin validation');
      return;
    }
    
    // Find the liquidated user
    const liquidatedUser = pre.users.find(user => {
      const afterUser = post.users.find(u => u.userId === user.userId);
      return user.hasPosition && afterUser && !afterUser.hasPosition;
    });
    
    if (!liquidatedUser) {
      console.log('⚠️  No liquidated user found');
      return;
    }
    
    const liquidatedUserPost = post.users.find(u => u.userId === liquidatedUser.userId);
    const liquidatedUserADL = adl.users.find(u => u.userId === liquidatedUser.userId);
    
    // Find the counterparty (profitable user who should pay via ADL)
    const counterparty = pre.users.find(u => u.userId !== liquidatedUser.userId);
    const counterpartyPost = post.users.find(u => u.userId === counterparty.userId);
    const counterpartyADL = adl.users.find(u => u.userId === counterparty.userId);
    
    console.log(`\n📋 ISOLATED MARGIN ANALYSIS:`);
    console.log(`  💔 Liquidated User: ${liquidatedUser.userId.toUpperCase()}`);
    console.log(`  💰 Counterparty: ${counterparty.userId.toUpperCase()}`);
    
    // 1. Check liquidated user lost only their margin
    const expectedLoss = liquidatedUser.usedMargin; // Maximum loss in isolated margin
    const actualBalanceChange = liquidatedUserADL.balance - liquidatedUser.balance;
    
    console.log(`\n🔍 ${liquidatedUser.userId.toUpperCase()} ISOLATED MARGIN CHECK:`);
    console.log(`  💰 Pre-liquidation: Balance=$${liquidatedUser.balance}, Margin=$${liquidatedUser.usedMargin}`);
    console.log(`  💰 Post-ADL: Balance=$${liquidatedUserADL.balance}`);
    console.log(`  📉 Expected Loss: $${expectedLoss} (margin only)`);
    console.log(`  📉 Actual Change: $${actualBalanceChange.toFixed(2)}`);
    
    if (Math.abs(Math.abs(actualBalanceChange) - expectedLoss) < 0.01) {
      console.log(`  ✅ CORRECT: Lost only margin amount in isolated position`);
    } else {
      console.log(`  🚨 ERROR: Lost more than margin! This violates isolated margin principle`);
    }
    
    // 2. Check counterparty absorbed the beyond-margin loss via ADL
    const counterpartyBalanceChange = counterpartyADL.balance - counterpartyPost.balance;
    console.log(`\n🔍 ${counterparty.userId.toUpperCase()} ADL SOCIALIZATION CHECK:`);
    console.log(`  💰 Post-liquidation: Balance=$${counterpartyPost.balance}`);
    console.log(`  💰 Post-ADL: Balance=$${counterpartyADL.balance}`);
    console.log(`  📉 ADL Impact: $${counterpartyBalanceChange.toFixed(2)}`);
    
    // Calculate what the beyond-margin loss should be
    // If eve lost $9k total but only $4.5k margin, then $4.5k should be socialized to bob
    const totalPositionLoss = 9000; // From $45k to $54k on 1 BTC short
    const beyondMarginLoss = totalPositionLoss - expectedLoss;
    
    console.log(`  📊 Expected ADL socialization: -$${beyondMarginLoss} (beyond-margin loss)`);
    
    if (Math.abs(counterpartyBalanceChange + beyondMarginLoss) < 0.01) {
      console.log(`  ✅ CORRECT: ADL properly socialized beyond-margin losses`);
    } else {
      console.log(`  🚨 ERROR: ADL did not properly socialize losses`);
    }
    
    // 3. Check system balance conservation
    const totalSystemPre = pre.users.reduce((sum, u) => sum + u.balance, 0);
    const totalSystemPost = adl.users.reduce((sum, u) => sum + u.balance, 0) + adl.insuranceFund;
    
    console.log(`\n🔍 SYSTEM CONSERVATION CHECK:`);
    console.log(`  💰 Pre-liquidation total: $${totalSystemPre.toFixed(2)}`);
    console.log(`  💰 Post-ADL total: $${totalSystemPost.toFixed(2)}`);
    console.log(`  📊 Difference: $${(totalSystemPost - totalSystemPre).toFixed(2)}`);
    
    if (Math.abs(totalSystemPost - totalSystemPre) < 0.01) {
      console.log(`  ✅ CORRECT: System conserved total value`);
    } else {
      console.log(`  🚨 ERROR: System lost/gained money during liquidation+ADL`);
    }
  }

  validateBalanceConservation(beforeLabel, afterLabel) {
    const before = this.financialSnapshots[beforeLabel];
    const after = this.financialSnapshots[afterLabel];
    
    if (!before || !after) {
      console.log(`\n⚠️  Cannot validate balance conservation: ${beforeLabel} or ${afterLabel} missing`);
      return;
    }
    
    console.log(`\n💰 BALANCE CONSERVATION CHECK: ${beforeLabel} → ${afterLabel}`);
    
    // Calculate TRUE system balance including insurance fund
    const beforeTotalSystemBalance = before.totalSystemBalance;
    const afterTotalSystemBalance = after.totalSystemBalance;
    
    console.log(`  🏦 Before Total System: $${beforeTotalSystemBalance.toFixed(2)} (Users: $${before.users.reduce((sum, u) => sum + u.balance, 0).toFixed(2)} + IF: $${before.insuranceFund.toFixed(2)})`);
    console.log(`  🏦 After Total System:  $${afterTotalSystemBalance.toFixed(2)} (Users: $${after.users.reduce((sum, u) => sum + u.balance, 0).toFixed(2)} + IF: $${after.insuranceFund.toFixed(2)})`);
    
    const difference = afterTotalSystemBalance - beforeTotalSystemBalance;
    console.log(`  📊 Net System Change: ${difference >= 0 ? '+' : ''}$${difference.toFixed(2)}`);
    
    if (Math.abs(difference) < 0.01) {
      console.log(`  ✅ BALANCE CONSERVED: No money created or destroyed in system`);
    } else {
      console.log(`  🚨 BALANCE VIOLATION: System ${difference > 0 ? 'CREATED' : 'DESTROYED'} $${Math.abs(difference).toFixed(2)}`);
      
      // Detailed breakdown
      console.log(`\n  📋 DETAILED SYSTEM BREAKDOWN:`);
      
      // User-by-user changes
      before.users.forEach(beforeUser => {
        const afterUser = after.users.find(u => u.userId === beforeUser.userId);
        if (afterUser) {
          const userChange = afterUser.balance - beforeUser.balance;
          if (Math.abs(userChange) > 0.01) {
            console.log(`    👤 ${beforeUser.userId}: $${beforeUser.balance} → $${afterUser.balance} (${userChange >= 0 ? '+' : ''}$${userChange.toFixed(2)})`);
          }
        }
      });
      
      // Insurance fund changes
      const fundChange = after.insuranceFund - before.insuranceFund;
      if (Math.abs(fundChange) > 0.01) {
        console.log(`    🏛️  Insurance Fund: $${before.insuranceFund.toFixed(2)} → $${after.insuranceFund.toFixed(2)} (${fundChange >= 0 ? '+' : ''}$${fundChange.toFixed(2)})`);
      }
      
      // Check for money creation sources
      const totalUserChanges = before.users.reduce((sum, beforeUser) => {
        const afterUser = after.users.find(u => u.userId === beforeUser.userId);
        return sum + (afterUser ? (afterUser.balance - beforeUser.balance) : 0);
      }, 0);
      
      console.log(`\n  🔍 ANALYSIS:`);
      console.log(`    👥 Total User Changes: ${totalUserChanges >= 0 ? '+' : ''}$${totalUserChanges.toFixed(2)}`);
      console.log(`    🏛️  Insurance Fund Change: ${fundChange >= 0 ? '+' : ''}$${fundChange.toFixed(2)}`);
      console.log(`    ⚖️  Expected Net: $${(totalUserChanges + fundChange).toFixed(2)}`);
      console.log(`    🚨 Actual Net: ${difference >= 0 ? '+' : ''}$${difference.toFixed(2)}`);
      
      if (Math.abs((totalUserChanges + fundChange) - difference) > 0.01) {
        console.log(`    💥 ACCOUNTING ERROR: Numbers don't add up! Money was ${difference > 0 ? 'created' : 'destroyed'} somewhere.`);
      }
    }
    
    return Math.abs(difference) < 0.01;
  }
}

async function main() {
  const tester = new ADLTester();
  await tester.connect();
  await tester.runTest();
}

if (require.main === module) {
  main().catch(console.error);
} 