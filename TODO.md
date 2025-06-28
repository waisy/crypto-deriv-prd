# Simulator TODO List

This file tracks the implementation of new features for the derivatives exchange simulator.

| ID  | Feature                       | Status      | Notes                                                                                                                              |
| --- | ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Manual Insurance Fund Adjustments | **Completed** | Add UI and an endpoint to allow manual deposits/withdrawals from the insurance fund, reflected in its history.                     |
| 2   | Persisted Sessions            | **In Progress** | Refactor state management and implement a save/load system for the entire exchange state (orders, positions, users, IF history, etc.). |

---

## Implementation Plan: Persisted Sessions

This plan outlines the remaining steps to complete the "Persisted Sessions" feature. The core architectural refactoring of `exchange.js` is complete, but it has caused breaking changes in the rest of the engine that must be resolved.

### Instructions for the Next Assistant

Your primary goal is to complete the state-serialization feature. The central `Exchange` class in `engine/exchange.js` has already been refactored to manage a single, comprehensive `state` object. All other engine components must now be updated to be compatible with this new architecture.

**Proceed with the following steps:**

1.  **Refactor `engine/orderbook.js`:**
    *   Modify the `OrderBook` class to be stateless. The constructor should accept the `state.orderBook` object as a reference.
    *   Update all methods (`addOrder`, `removeOrder`, `preventSelfMatch`, etc.) to operate directly on the properties of the state object passed to the constructor (`this.bids`, `this.asks`, `this.orders`).
    *   Ensure the data structures used are simple arrays and objects for easy JSON serialization.

2.  **Refactor `engine/liquidation.js`:**
    *   Modify the `LiquidationEngine` class to be stateless. The constructor will receive the `state.liquidationEngine` object.
    *   Update all methods to read from and write to this state slice (e.g., `this.state.insuranceFund += ...`).
    *   The `liquidate` method's logic will need significant updates to work with the new `MatchingEngine` and `OrderBook` interfaces. It should create a liquidation order and pass it to the matching engine.

3.  **Refactor `engine/matching.js`:**
    *   The `MatchingEngine` class is mostly stateless logic, which is good.
    *   Update its `match` method to accept the `orderBook` state object (`state.orderBook`) directly, rather than an instance of the `OrderBook` class.
    *   Ensure it correctly mutates the `bids`, `asks`, and `orders` arrays/objects within that state slice.

4.  **Verify Other Engine Components:**
    *   Review `user.js`, `position.js`, `margin.js`, and `margin-monitor.js`.
    *   Confirm that `User` and `Position` classes are easily serializable. The `rehydrateStateObjects` method in `exchange.js` is designed to restore class instances from plain JSON, but the classes themselves must be compatible.
    *   Ensure the calculator/monitor classes are stateless and take state data as method arguments.

5.  **Implement Server-Side Save/Load Logic in `server.js`:**
    *   Create a `POST /api/session/save` endpoint. This should:
        *   Call `exchange.getState()`.
        *   Generate a short, unique, random name (e.g., `silver-pony-82`).
        *   Save the JSON-stringified state to a new file: `sessions/<name>.json`.
        *   Return the `{ name: "silver-pony-82" }` to the client.
    *   Create a `POST /api/session/load` endpoint that takes a `{ name: "..." }` in the body. This should:
        *   Read the corresponding file from the `sessions/` directory.
        *   Parse the JSON into a state object.
        *   Call `exchange.setState(loadedState)`.
        *   Broadcast the new state to all connected WebSocket clients.

6.  **Implement Client-Side UI in `public/index.html`:**
    *   Add "Save Session" and "Load Session" buttons to the main UI.
    *   **Save Button:** On click, call the `/api/session/save` endpoint. On success, show the user the generated session name (e.g., using `alert()` or a modal).
    *   **Load Button:** On click, use `prompt()` to ask the user for a session name. Call the `/api/session/load` endpoint with that name. The existing WebSocket `onmessage` handler should automatically update the UI when it receives the broadcasted new state.

### Instructions for the User (@Wais)

The refactoring process has been challenging due to tool limitations on my end. The plan above provides a clear path forward.

1.  **Verify `exchange.js`:** The last operation I performed was a full-file refactoring of `derivs-simulator/engine/exchange.js`. Please ensure this file on your machine reflects the new state-centric architecture.
2.  **Provide Full Context:** When you start a session with a new assistant, please manually attach the entire `derivs-simulator/engine` directory. This is crucial to avoid the file-reading issues that blocked me.
3.  **Next Steps:** Instruct the new assistant to follow the implementation plan documented here in `TODO.md`, starting with Step 1: Refactoring `engine/orderbook.js`.

I am confident that with a clean start and full file access, the next assistant will be able to complete this feature efficiently. 