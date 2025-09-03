# Subaccounts

> **Status**: 🤖 AI Generated (Unreviewed) | **Last Updated**: 2025-03-09 | **Needs**: External validation, manual review

## Overview

Subaccounts are a crucial feature for any exchange catering to institutional clients, sophisticated individual traders, and platform integrators. They allow a single master account to create and manage multiple, separate trading accounts under a unified structure. This provides powerful tools for risk management, strategy segregation, and operational efficiency.

## Why Subaccounts? Core Benefits

- **Risk Segregation**: Isolate the risk of different trading strategies. If a high-risk strategy in one subaccount is liquidated, it doesn't affect the funds or positions in other subaccounts or the master account.
- **Strategy Segmentation**: Allocate capital and manage PnL for distinct trading algorithms or teams. This makes performance tracking and accounting clean and simple.
- **API Key Security**: Generate unique API keys for each subaccount. If one key is compromised, it can be disabled without affecting other trading strategies. Access can be limited to specific functions (e.g., trade-only, withdraw-disabled).
- **Operational Efficiency**: Manage funds, view exposure, and run reports across all accounts from a single master dashboard, while still maintaining separation at the execution level.

## Primary Use Cases

### 1. For Institutional Clients (Hedge Funds, Prop Trading Firms)
This is the primary driver for the feature.
- **Multi-Strategy Funds**: A fund may run a market-making strategy, a long-term holding strategy, and a high-frequency scalping strategy. Each can be assigned its own subaccount with a specific capital allocation and risk profile.
- **Trader Desks**: A proprietary trading firm can create a subaccount for each trader or trading desk. The master account, controlled by the risk management team, can oversee overall exposure and transfer funds.
- **Client Asset Management**: A firm managing assets for multiple clients can use subaccounts to segregate the funds and trading activity of each client for clear reporting and billing.

### 2. For Sophisticated Individual Traders
- **Bot Trading**: A trader might run a personal portfolio in their master account but use a subaccount for a third-party trading bot. This isolates the bot's risk and prevents it from having access to the trader's full capital.
- **Testing New Strategies**: A trader can test a new, potentially risky strategy in a subaccount with a small amount of capital before deploying it on a larger scale.

### 3. For Platform Integrators & Brokers
- **Third-Party Services**: A portfolio management service or copy-trading platform can use subaccounts to manage the trades of their underlying users on the exchange.
- **Brokerages**: A crypto broker can use the exchange's subaccount structure as the back-end for their own client accounts, simplifying their infrastructure.

## Key Features & Functionality

A robust subaccount system should provide the following capabilities, accessible via both UI and API:

- **Creation & Management**: Programmatically create and label subaccounts.
- **Fund Transfers**: Instantly and without fees, transfer assets between the master account and any of its subaccounts, or even directly between two subaccounts.
- **Permissions Control**:
    - **API Keys**: Generate distinct API keys for each subaccount with granular permissions (e.g., read-only, trade-enabled, withdrawal-disabled).
    - **Login Access**: Some exchanges allow direct login access to subaccounts for specific users.
- **Trading**: Subaccounts function as independent accounts with their own balances, margin, positions, and order history.
- **Unified Reporting**: The master account should have a dashboard to view aggregated balances, total PnL, and risk exposure across all subaccounts, as well as the ability to download detailed reports for each individual subaccount.

## Subaccount Hierarchy

The standard and most common model is a **two-level hierarchy**:

1.  **Master Account**: The top-level entity that owns all subaccounts and has ultimate control. It can manage permissions, transfer funds, and view all activity.
2.  **Subaccounts**: The child accounts that sit directly under the master. They can trade independently but cannot create other subaccounts.

While deeper, multi-level hierarchies (sub-subaccounts) are technically possible, they are rarely implemented in practice. They introduce significant complexity in terms of permissions, fund flows, and risk aggregation, with diminishing practical benefits for most use cases.

## Technical & Implementation Considerations

- **Account Data Model**: The `users` or `accounts` table needs a concept of a `parent_account_id` to link subaccounts to their master. The master account will have this field as `null`.
- **Balance Management**: The system must ensure that fund transfers are atomic operations to prevent inconsistencies. A central ledger service is crucial. While transfers are internal, they must be recorded immutably.
- **API Gateway**: The API needs to be designed to handle requests for subaccounts. This is often done via a special header (`X-SUBACCOUNT-ID`) or as a parameter in the request body, which the master account's API key can specify to act on behalf of a subaccount.
- **Risk & Margin Engine**: The risk engine must be able to calculate margin and risk at both the individual subaccount level and the aggregated master account level. Exchanges must decide if margin is calculated on an isolated basis per subaccount or if cross-margin can be enabled at the master account level (a much more complex feature).
- **Authentication & Authorization**: The permission system is critical. A request using a master key acting on a subaccount must be validated against both master and subaccount permissions. A request using a subaccount-specific key should be locked to that subaccount only. 