# Index Price Implementation: Technical Requirements

## Overview

A robust and resilient Index Price is the cornerstone of a fair and stable derivatives exchange. It serves as the "source of truth" for the underlying asset's price, and its accuracy directly impacts funding rates, liquidations, and PnL calculations. This document outlines the technical requirements for implementing a fault-tolerant index price system.

## 1. Data Source Selection

The quality of the index price depends entirely on the quality of its constituent data sources.

### Selection Criteria
- **High Volume & Liquidity**: Exchanges must have significant, legitimate trading volume to prevent manipulation.
- **Reputable & Regulated**: Prioritize exchanges with strong reputations and regulatory oversight.
- **Reliable API**: The exchange must provide a stable, low-latency, and well-documented API (WebSocket preferred for real-time data).
- **Geographic & Jurisdictional Diversity**: Use a mix of exchanges from different regions to reduce single-point-of-failure risk (e.g., one country banning crypto).
- **Minimum Number of Sources**: A minimum of 5-7 diverse and reliable exchanges is recommended.

## 2. Data Ingestion & Normalization

The system must efficiently ingest data from multiple sources and normalize it into a standard format.

### Architecture
- **Microservices-based**: Dedicate an independent service (a "connector" or "adapter") for each exchange feed. This isolates failures.
- **WebSocket First**: Use WebSocket streams for the lowest latency. Fall back to periodic REST API polling if a WebSocket is unavailable or disconnects.
- **Data Normalization**: Each connector must transform the exchange-specific data format into a standardized internal format.
  ```json
  {
    "source": "ExchangeName",
    "symbol": "BTC/USD",
    "price": 45001.50,
    "volume_24h": 15000.5,
    "timestamp": 1672531200123
  }
  ```

## 3. Calculation Engine

The core logic that computes the final index price from the various feeds. The calculation is a multi-step process designed to ensure fairness and accuracy by filtering outliers and weighting sources appropriately.

### Step 1: Filter Healthy Feeds
Before any calculation, the engine must ingest the latest data points from all connectors and filter out any unhealthy or unreliable sources.
- **Stale Data Check**: If a source's `timestamp` has not updated within a defined window (e.g., 10 seconds), it is considered **stale** and must be excluded from this calculation cycle.
- **Price Deviation Check (Outlier Detection)**: First, calculate the median price of all currently non-stale feeds. If a source's price deviates by more than a set percentage (e.g., 2.5%) from this median, it is considered an **outlier** and should also be excluded from this cycle.

### Step 2: Calculate Volume Weight
For each of the remaining healthy feeds, calculate its weight based on its reported 24-hour trading volume. This ensures that exchanges with more liquidity have a greater influence on the index price.

```
// For each healthy feed i:
Volume_i = Feed_i.volume_24h

// Total volume of all healthy feeds:
Total_Volume = Sum(Volume_1, Volume_2, ..., Volume_n)

// Volume weight for each feed:
Volume_Weight_i = Volume_i / Total_Volume
```

### Step 3: Calculate Recency Weight (Time-Decay Factor)
To prioritize the most recent data, apply an exponential decay factor to the weights. This penalizes prices that, while not stale enough to be excluded, are older than other prices in the set.

```
// Age of the data from feed i (in seconds):
Age_i = (Current_Timestamp - Feed_i.timestamp) / 1000

// Decay constant (alpha) determines how quickly a source's influence fades.
// A higher alpha means faster decay.
Alpha = 0.05

// Recency weight for each feed:
Recency_Weight_i = exp(-Alpha * Age_i)
```
With `Alpha = 0.05`:
- A price that is 0 seconds old has a recency weight of `exp(0) = 1.0` (full weight).
- A price that is 5 seconds old has a recency weight of `exp(-0.25) ≈ 0.77`.
- A price that is 10 seconds old has a recency weight of `exp(-0.5) ≈ 0.60`.

### Step 4: Combine Weights and Calculate Final Index Price
The final weight for each source is the product of its volume weight and its recency weight. The index price is the sum of each source's price multiplied by its final, normalized weight.

```
// 1. Calculate the combined (un-normalized) weight for each feed:
Combined_Weight_i = Volume_Weight_i * Recency_Weight_i

// 2. Calculate the total of all combined weights:
Total_Combined_Weight = Sum(Combined_Weight_1, Combined_Weight_2, ...)

// 3. Normalize the combined weight for each feed:
Final_Weight_i = Combined_Weight_i / Total_Combined_Weight

// 4. Calculate the final index price:
Index_Price = Sum(Feed_i.price * Final_Weight_i)
```

### Comprehensive Example:
Assume 4 feeds are active (Feed D is already stale and excluded):

| Feed  | Price     | Volume (24h) | Timestamp (Age) |
|-------|-----------|--------------|-----------------|
| A     | $45,010   | $500M        | 1s ago          |
| B     | $45,005   | $300M        | 0s ago          |
| C     | $45,015   | $200M        | 4s ago          |
| E     | $46,500   | $50M         | 1s ago          |

**Step 1: Filter**
- Median price of {45010, 45005, 45015, 46500} is $45012.5.
- Feed E's price ($46,500) deviates by `(46500 - 45012.5) / 45012.5 ≈ 3.3%`.
- Assuming a 2.5% threshold, **Feed E is excluded as an outlier.**

**Remaining Healthy Feeds:** A, B, C. Total Volume = $500M + $300M + $200M = $1B.

**Step 2: Volume Weights**
- `Volume_Weight_A` = 500M / 1B = 0.5
- `Volume_Weight_B` = 300M / 1B = 0.3
- `Volume_Weight_C` = 200M / 1B = 0.2

**Step 3: Recency Weights** (`Alpha = 0.05`)
- `Recency_Weight_A` (1s old) = `exp(-0.05 * 1)` ≈ 0.951
- `Recency_Weight_B` (0s old) = `exp(-0.05 * 0)` = 1.0
- `Recency_Weight_C` (4s old) = `exp(-0.05 * 4)` ≈ 0.819

**Step 4: Final Calculation**
- `Combined_Weight_A` = 0.5 * 0.951 = 0.4755
- `Combined_Weight_B` = 0.3 * 1.0   = 0.3
- `Combined_Weight_C` = 0.2 * 0.819 = 0.1638
- `Total_Combined_Weight` = 0.4755 + 0.3 + 0.1638 = 0.9393

- `Final_Weight_A` = 0.4755 / 0.9393 ≈ 0.506
- `Final_Weight_B` = 0.3    / 0.9393 ≈ 0.319
- `Final_Weight_C` = 0.1638 / 0.9393 ≈ 0.174

- **`Index_Price`** = `(45010 * 0.506) + (45005 * 0.319) + (45015 * 0.174)`
- **`Index_Price`** = `22775.06 + 14356.60 + 7832.61` = **`$44,964.27`**

This multi-step process ensures the final index price is robust, manipulation-resistant, and reflective of the most current and significant market activity.

## 4. Resiliency & Fault Tolerance

This is the most critical aspect of the implementation. The system must remain accurate and available even when some of its data sources fail.

### Handling Loss of Feeds
- **Minimum Sources Threshold**: The system must define a minimum number of healthy feeds required to publish a valid index price (e.g., at least 3 out of 5). If the number of healthy feeds drops below this threshold, the system should enter a "degraded" state.
- **Automatic Re-weighting**: If a feed is dropped (due to being stale, an outlier, or a network issue), the weights of the remaining healthy feeds should be recalculated automatically.
- **Circuit Breakers**: If the number of active feeds falls below the minimum threshold, or if the calculated index price changes by an extreme amount (e.g., >5% in one second), the system should trigger a circuit breaker. This might involve:
  - Temporarily halting liquidations.
  - Pausing updates to the index price and using the last known good value.
  - Sending critical alerts to the operations team.

### Handling Stale Data
- **Timestamp Monitoring**: The calculation engine must check the `timestamp` of each incoming data point.
- **Heartbeat Mechanism**: For WebSocket connections, implement a heartbeat mechanism. If a heartbeat is not received within a specified interval, the connection is considered stale and should be re-established. The feed is excluded until the connection is healthy again.

### Redundancy
- **Component Redundancy**: Run multiple instances of the calculation engine and each feed connector. Use a leader-election process (e.g., via ZooKeeper or Consul) to determine which instance is the active one publishing the price.
- **Geographic Redundancy**: Deploy the index price infrastructure across multiple availability zones or cloud providers to protect against regional outages.

## 5. System Monitoring & Alerting

Continuous monitoring is essential to ensure the health and accuracy of the index price.

### Key Metrics to Monitor
- **Number of Active Feeds**: The current count of healthy, contributing data sources.
- **Feed Latency**: The time delay for each exchange feed.
- **Price Spread**: The percentage difference between the highest and lowest prices from the active feeds.
- **Calculation Frequency**: How often the index price is being updated.
- **Last Update Timestamp per Feed**: To track data freshness.

### Alerting Rules
- **Critical Alert**: If the number of active feeds drops below the minimum threshold.
- **Critical Alert**: If a circuit breaker is triggered.
- **Warning Alert**: If a single feed becomes stale or is dropped.
- **Warning Alert**: If the price spread between sources exceeds a predefined level (e.g., >1%).

## 6. Security Considerations

- **API Key Management**: Use secure vaults (e.g., HashiCorp Vault, AWS KMS) to store API keys for exchange access. Rotate keys regularly.
- **Network Security**: Use IP whitelisting to ensure that only your system's servers can access exchange APIs.
- **Data Integrity**: Although unlikely, consider checksums or other methods to ensure data has not been tampered with in transit, if the exchange APIs support it. 