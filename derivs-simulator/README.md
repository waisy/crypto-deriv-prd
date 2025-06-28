# Derivatives Exchange Simulator

A comprehensive derivatives exchange simulator for BTC-USDT linear contracts with a modern web interface.

## Features

✅ **Core Features Implemented:**
- **Matching Engine**: Full order matching with limit and market orders
- **Dual User Support**: Switch between two users for testing
- **Leverage Trading**: Configurable leverage from 1x to 100x
- **Margin Calculations**: Real-time IMR and MMR calculations
- **Position Tracking**: Complete position management with PnL
- **Liquidation Engine**: Automatic liquidation when margin falls below maintenance
- **ADL System**: Auto-deleveraging when insurance fund is insufficient
- **Real-time Updates**: WebSocket-based live updates
- **Order Book**: Live order book with bid/ask levels
- **Trade History**: Real-time trade execution logs

## System Architecture

### Backend Components
- **Exchange Engine** (`engine/exchange.js`): Main coordinator
- **Order Book** (`engine/orderbook.js`): Order management
- **Matching Engine** (`engine/matching.js`): Order matching logic
- **Position Manager** (`engine/position.js`): Position tracking
- **Margin Calculator** (`engine/margin.js`): Margin and liquidation calculations
- **Liquidation Engine** (`engine/liquidation.js`): Liquidation handling
- **ADL Engine** (`engine/adl.js`): Auto-deleveraging system
- **User Manager** (`engine/user.js`): User account management

### Frontend
- **Modern UI**: Dark theme with professional trading interface
- **Real-time Data**: WebSocket connection for live updates
- **Responsive Design**: Works on desktop and mobile
- **Interactive Charts**: Position and PnL visualization

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Quick Start

1. **Install Dependencies**
```bash
cd derivs-simulator
npm install
```

2. **Start the Server**
```bash
npm start
```

3. **Open Browser**
Navigate to `http://localhost:3000`

### Development Mode
```bash
npm run dev  # Starts with nodemon for auto-restart
```

## Usage Guide

### Basic Trading Flow

1. **Select User**: Click on User 1 or User 2 tabs
2. **Set Parameters**: 
   - Choose Long/Short
   - Select order type (Market/Limit)
   - Enter size and price
   - Set leverage (1x-100x)
3. **Place Order**: Click "Place Order"
4. **Monitor**: Watch positions, PnL, and order book updates

### Key Features

#### Margin System
- **Initial Margin**: Required to open position = Position Value / Leverage
- **Maintenance Margin**: 0.5% of position value
- **Liquidation**: Triggered when margin ratio drops below maintenance level

#### Liquidation Mechanics
- **Liquidation Price**: Calculated using linear contract formulas
- **Bankruptcy Price**: Where all margin is lost
- **Insurance Fund**: Covers losses beyond bankruptcy price
- **Partial Liquidation**: Reduces position size to maintain margin

#### Auto-Deleveraging (ADL)
- **Ranking System**: Based on profit percentage × effective leverage
- **Indicator**: 5-light system showing ADL risk
- **Execution**: Automatic when insurance fund insufficient

### Testing Scenarios

#### Test Liquidation
1. Open a high-leverage position (50x-100x)
2. Use the price update feature to move price against position
3. Watch liquidation trigger automatically

#### Test ADL
1. Create profitable positions on both users
2. Force a large liquidation that depletes insurance fund
3. Observe ADL execution on profitable positions

## Technical Implementation

### Margin Calculations (Linear Contracts)

```javascript
// Liquidation Price for Long Position
liquidationPrice = entryPrice × (1 - 1/leverage + maintenanceMarginRate)

// Liquidation Price for Short Position  
liquidationPrice = entryPrice × (1 + 1/leverage - maintenanceMarginRate)

// Initial Margin
initialMargin = positionValue / leverage

// Maintenance Margin
maintenanceMargin = positionValue × 0.005 // 0.5%
```

### PnL Calculations

```javascript
// Long Position PnL
pnl = (currentPrice - entryPrice) × positionSize

// Short Position PnL
pnl = (entryPrice - currentPrice) × positionSize

// ROE (Return on Equity)
roe = pnl / initialMargin × 100
```

### ADL Score Formula

```javascript
adlScore = (unrealizedPnL / positionValue) × (positionValue / totalEquity)
```

## WebSocket API

### Client → Server Messages
```javascript
// Place Order
{
  type: 'place_order',
  userId: 'user1',
  side: 'buy',
  size: 0.1,
  price: 45000,
  type: 'limit',
  leverage: 10
}

// Update Mark Price
{
  type: 'update_mark_price',
  price: 46000
}

// Force Liquidation
{
  type: 'force_liquidation',
  userId: 'user1'
}
```

### Server → Client Messages
```javascript
// State Update
{
  type: 'update',
  state: {
    users: [...],
    positions: [...],
    trades: [...],
    orderBook: {...},
    markPrice: 45000,
    adlQueue: [...]
  }
}
```

## File Structure

```
derivs-simulator/
├── engine/           # Core trading engine
│   ├── exchange.js   # Main exchange coordinator
│   ├── orderbook.js  # Order book management
│   ├── matching.js   # Order matching engine
│   ├── position.js   # Position tracking
│   ├── margin.js     # Margin calculations
│   ├── liquidation.js # Liquidation engine
│   ├── adl.js        # Auto-deleveraging
│   └── user.js       # User management
├── public/           # Frontend files
│   ├── index.html    # Main HTML
│   ├── styles.css    # Styling
│   └── app.js        # Frontend JavaScript
├── server.js         # Express server + WebSocket
├── package.json      # Dependencies
└── README.md         # This file
```

## Supported Operations

- ✅ Place Market/Limit Orders
- ✅ Real-time Order Matching
- ✅ Position Management
- ✅ Margin Calculations (IMR/MMR)
- ✅ Liquidation Processing
- ✅ ADL Execution
- ✅ PnL Tracking
- ✅ User Account Management
- ✅ Live Price Updates
- ✅ Order Book Display
- ✅ Trade History

## Future Enhancements

- [ ] Funding Rate Mechanism
- [ ] Multiple Contract Support
- [ ] Advanced Order Types (Stop-Loss, Take-Profit)
- [ ] Historical Data & Charts
- [ ] Risk Management Tools
- [ ] Performance Analytics
- [ ] Multi-user Support (beyond 2)
- [ ] Persistent Data Storage

## License

MIT License - Feel free to use and modify for educational purposes. 