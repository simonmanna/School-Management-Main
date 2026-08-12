import { Injectable } from '@nestjs/common';

export interface DepreciationInput {
  cost: number;
  salvageValue: number;
  usefulLife: number; // months
  currentBookValue: number;
  accumulatedDepreciation: number;
  period: string;
}

export interface DepreciationResult {
  depreciationAmount: number;
  accumulatedDepreciation: number;
  bookValue: number;
}

@Injectable()
export class AssetDepreciationStrategy {
  calculate(method: string, input: DepreciationInput): DepreciationResult {
    switch (method) {
      case 'straight_line': return this.straightLine(input);
      case 'declining_balance': return this.decliningBalance(input);
      case 'double_declining': return this.doubleDeclining(input);
      case 'units_of_production': return this.unitsOfProduction(input);
      case 'manual': return this.manual(input);
      default: return this.straightLine(input);
    }
  }

  private straightLine(input: DepreciationInput): DepreciationResult {
    const depreciableBase = input.cost - input.salvageValue;
    const monthlyDepr = depreciableBase / Math.max(1, input.usefulLife);
    const amount = Math.min(monthlyDepr, input.currentBookValue - input.salvageValue);
    const newAccumulated = input.accumulatedDepreciation + amount;
    return {
      depreciationAmount: Math.max(0, amount),
      accumulatedDepreciation: newAccumulated,
      bookValue: Math.max(input.salvageValue, input.cost - newAccumulated),
    };
  }

  private decliningBalance(input: DepreciationInput): DepreciationResult {
    const rate = 2 / Math.max(1, input.usefulLife / 12);
    const amount = input.currentBookValue * rate / 12;
    const maxDepr = input.currentBookValue - input.salvageValue;
    const finalAmount = Math.min(amount, maxDepr);
    const newAccumulated = input.accumulatedDepreciation + finalAmount;
    return {
      depreciationAmount: Math.max(0, finalAmount),
      accumulatedDepreciation: newAccumulated,
      bookValue: Math.max(input.salvageValue, input.cost - newAccumulated),
    };
  }

  private doubleDeclining(input: DepreciationInput): DepreciationResult {
    const rate = 4 / Math.max(1, input.usefulLife / 12);
    const amount = input.currentBookValue * rate / 12;
    const maxDepr = input.currentBookValue - input.salvageValue;
    const finalAmount = Math.min(amount, maxDepr);
    const newAccumulated = input.accumulatedDepreciation + finalAmount;
    return {
      depreciationAmount: Math.max(0, finalAmount),
      accumulatedDepreciation: newAccumulated,
      bookValue: Math.max(input.salvageValue, input.cost - newAccumulated),
    };
  }

  private unitsOfProduction(input: DepreciationInput): DepreciationResult {
    return this.straightLine(input);
  }

  private manual(input: DepreciationInput): DepreciationResult {
    return {
      depreciationAmount: 0,
      accumulatedDepreciation: input.accumulatedDepreciation,
      bookValue: input.currentBookValue,
    };
  }
}
