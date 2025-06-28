const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Import the exchange engine
const { Exchange } = require('./engine/exchange');
const exchange = new Exchange();

// WebSocket connections
const clients = new Map();

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const response = exchange.handleMessage(data);
      
      // Broadcast to all clients for real-time updates
      const broadcastData = {
        type: 'update',
        ...response
      };
      
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(broadcastData));
        }
      });
    } catch (error) {
      ws.send(JSON.stringify({ error: error.message }));
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
  });

  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    state: exchange.getState()
  }));
});

// REST API endpoints
app.get('/api/state', (req, res) => {
  res.json(exchange.getState());
});

app.post('/api/order', (req, res) => {
  try {
    const result = exchange.placeOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/price', (req, res) => {
  try {
    const result = exchange.updateMarkPrice(req.body.price);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Derivatives Exchange Simulator running on port ${PORT}`);
}); 