import { Decimal } from 'decimal.js';

export interface UserJSON {
  id: string;
  name: string;
  totalBalance: string;
  availableBalance: string;
  usedMargin: string;
  unrealizedPnL: string;
  leverage: number;
  totalPnL: string;
  marginRatio: string;
  equity: string;
}

export class User {
  public id: string;
  public name: string;
  public availableBalance: Decimal;
  public usedMargin: Decimal;
  public unrealizedPnL: Decimal;
  public leverage: number;
  public totalPnL: Decimal;

  constructor(id: string, name: string, initialBalance: number | string | Decimal) {
    this.id = id;
    this.name = name;
    this.availableBalance = new Decimal(initialBalance);
    this.usedMargin = new Decimal(0);
    this.unrealizedPnL = new Decimal(0);
    this.leverage = 10; // Default 10x leverage
    this.totalPnL = new Decimal(0);
  }

  getTotalBalance(): Decimal {
    return this.availableBalance.plus(this.usedMargin);
  }

  updateAvailableBalance(amount: number | string | Decimal): void {
    const decAmount = new Decimal(amount);
    this.availableBalance = this.availableBalance.plus(decAmount);
  }

  deposit(amount: number | string | Decimal): void {
    const decAmount = new Decimal(amount);
    this.availableBalance = this.availableBalance.plus(decAmount);
  }

  withdraw(amount: number | string | Decimal): void {
    const decAmount = new Decimal(amount);
    if (decAmount.greaterThan(this.availableBalance)) {
      throw new Error('Insufficient available balance for withdrawal');
    }
    this.availableBalance = this.availableBalance.minus(decAmount);
  }

  updatePnL(unrealizedPnL: number | string | Decimal): void {
    this.unrealizedPnL = new Decimal(unrealizedPnL);
  }

  // New method to handle P&L realization
  realizePnL(realizedAmount: number | string | Decimal): void {
    const decAmount = new Decimal(realizedAmount);
    this.availableBalance = this.availableBalance.plus(decAmount);
    this.totalPnL = this.totalPnL.plus(decAmount);
  }

  // New method to release margin back to available balance
  releaseMargin(marginAmount: number | string | Decimal): void {
    const decAmount = new Decimal(marginAmount);
    if (decAmount.greaterThan(this.usedMargin)) {
      throw new Error('Cannot release more margin than currently used');
    }
    this.usedMargin = this.usedMargin.minus(decAmount);
    this.availableBalance = this.availableBalance.plus(decAmount);
  }

  getEquity(): Decimal {
    return this.getTotalBalance().plus(this.unrealizedPnL);
  }

  toJSON(): UserJSON {
    return {
      id: this.id,
      name: this.name,
      totalBalance: this.getTotalBalance().toString(),
      availableBalance: this.availableBalance.toString(),
      usedMargin: this.usedMargin.toString(),
      unrealizedPnL: this.unrealizedPnL.toString(),
      leverage: this.leverage,
      totalPnL: this.totalPnL.toString(),
      marginRatio: 'N/A',
      equity: this.getEquity().toString()
    };
  }
} 