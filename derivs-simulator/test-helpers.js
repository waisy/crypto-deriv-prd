const { spawn, exec } = require('child_process');
const WebSocket = require('ws');

class TestServerManager {
  constructor() {
    this.serverProcess = null;
    this.isServerRunning = false;
    this.port = 3000;
  }

  // Remove singleton - each test file should create its own instance
  static getInstance() {
    return new TestServerManager();
  }

  async killExistingServers() {
    return new Promise((resolve) => {
      // Kill server processes
      exec('pkill -f "ts-node.*server.js" || pkill -f "node.*server.js" || pkill -f "npm.*start"', (error) => {
        // Also kill any processes using port 3000
        exec('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', (error2) => {
          // Wait for cleanup to complete
          setTimeout(resolve, 3000);
        });
      });
    });
  }

  async checkPortAvailable() {
    return new Promise((resolve) => {
      exec(`lsof -i :${this.port}`, (error, stdout) => {
        resolve(error !== null); // Port is available if lsof returns error
      });
    });
  }

  async startServer() {
    console.log('🔄 Starting fresh server instance...');
    
    // Always kill existing servers first
    await this.killExistingServers();
    
    // Wait for port to be available
    let portAvailable = false;
    for (let i = 0; i < 15; i++) {
      portAvailable = await this.checkPortAvailable();
      if (portAvailable) break;
      console.log(`⏳ Waiting for port ${this.port} to be available... (attempt ${i + 1}/15)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!portAvailable) {
      throw new Error(`Port ${this.port} is still in use after cleanup`);
    }

    return new Promise((resolve, reject) => {
      console.log('🚀 Starting test server...');
      
      this.serverProcess = spawn('npm', ['start'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...process.env, NODE_ENV: 'test' }
      });

      let startupOutput = '';
      let hasResolved = false;
      
      this.serverProcess.stdout.on('data', (data) => {
        startupOutput += data.toString();
        
        // Look for server ready indicators
        if (!hasResolved && (
          startupOutput.includes('EXCHANGE INITIALIZED') || 
          startupOutput.includes('listening on port 3000') ||
          startupOutput.includes('Server listening'))) {
          
          hasResolved = true;
          this.isServerRunning = true;
          console.log('✅ Test server started successfully');
          resolve();
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        if (errorOutput.includes('EADDRINUSE') && !hasResolved) {
          hasResolved = true;
          reject(new Error('Port 3000 already in use'));
        }
      });

      this.serverProcess.on('error', (error) => {
        if (!hasResolved) {
          hasResolved = true;
          reject(new Error(`Server startup failed: ${error.message}`));
        }
      });

      this.serverProcess.on('exit', (code) => {
        this.isServerRunning = false;
        if (code !== 0 && code !== null && !hasResolved) {
          hasResolved = true;
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Timeout after 25 seconds
      setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          reject(new Error('Server startup timeout - check if TypeScript compilation is working'));
        }
      }, 25000);
    });
  }

  async stopServer() {
    if (this.serverProcess && this.isServerRunning) {
      console.log('🛑 Stopping test server...');
      
      // Try graceful shutdown first
      this.serverProcess.kill('SIGTERM');
      
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Force kill if still running
      if (this.isServerRunning) {
        this.serverProcess.kill('SIGKILL');
      }
      
      this.serverProcess = null;
      this.isServerRunning = false;
      
      // Additional cleanup
      await this.killExistingServers();
    }
  }

  async testConnection() {
    return new Promise((resolve) => {
      const ws = new WebSocket('ws://localhost:3000');
      
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 3000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });
      
      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async ensureServerRunning() {
    // Always start a fresh server for each test file
    await this.startServer();
    
    // Wait a bit for full initialization
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify connection works
    const finalTest = await this.testConnection();
    if (!finalTest) {
      throw new Error('Server started but not accepting connections');
    }
  }

  static async cleanup() {
    // Kill any remaining servers
    return new Promise((resolve) => {
      exec('pkill -f "ts-node.*server.js" || pkill -f "node.*server.js" || pkill -f "npm.*start"', (error) => {
        setTimeout(resolve, 2000);
      });
    });
  }
}

class TestWebSocketClient {
  constructor(url = 'ws://localhost:3000') {
    this.url = url;
    this.ws = null;
    this.requestId = 0;
    this.responses = new Map();
    this.timeouts = new Set();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${error.message}`));
      });
      
      this.ws.on('close', () => {
        clearTimeout(timeout);
        reject(new Error('Connection closed'));
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Message parsing error:', error);
        }
      });
    });
  }

  handleMessage(message) {
    if (message.requestId && this.responses.has(message.requestId)) {
      const resolver = this.responses.get(message.requestId);
      this.responses.delete(message.requestId);
      resolver(message);
    }
  }

  async sendMessage(data) {
    return new Promise((resolve, reject) => {
      this.requestId++;
      const requestId = this.requestId;
      data.requestId = requestId;

      this.responses.set(requestId, resolve);

      this.ws.send(JSON.stringify(data));

      const responseTimeout = setTimeout(() => {
        this.responses.delete(requestId);
        this.timeouts.delete(responseTimeout);
        reject(new Error(`Timeout waiting for response to ${data.type}`));
      }, 10000);
      
      this.timeouts.add(responseTimeout);
    });
  }

  async getState() {
    const response = await this.sendMessage({ type: 'get_state' });
    return response.state;
  }

  async placeOrder(userId, side, size, price, leverage, orderType = 'limit') {
    return await this.sendMessage({
      type: 'place_order',
      userId,
      side,
      size,
      price,
      orderType,
      leverage
    });
  }

  async updateMarkPrice(price) {
    return await this.sendMessage({
      type: 'update_mark_price',
      price
    });
  }

  async executeLiquidationStep(method) {
    return await this.sendMessage({
      type: 'liquidation_step',
      method
    });
  }

  async resetState() {
    const response = await this.sendMessage({
      type: 'reset_state'
    });
    
    // Wait a bit for reset to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify state is actually reset
    const state = await this.getState();
    
    // Check that state is clean
    if (state.positions && state.positions.length > 0) {
      console.warn('⚠️ State reset incomplete - positions still exist:', state.positions.length);
      // Try reset again
      await this.sendMessage({ type: 'reset_state' });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (state.liquidationPositions && state.liquidationPositions.length > 0) {
      console.warn('⚠️ State reset incomplete - liquidation positions still exist:', state.liquidationPositions.length);
    }
    
    return response;
  }

  disconnect() {
    // Clear all timeouts
    for (const timeout of this.timeouts) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.responses.clear();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = {
  TestServerManager,
  TestWebSocketClient
}; 