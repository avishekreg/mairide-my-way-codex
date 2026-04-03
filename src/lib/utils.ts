import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export const GST_RATE = 0.18; // 18% GST in India

export function calculateServiceFee(fare: number, config?: { maintenanceFeeBase?: number, gstRate?: number }) {
  const baseFee = config?.maintenanceFeeBase ?? 100; // Fixed 100 INR platform maintenance fee or from config
  const rawGstRate = config?.gstRate ?? GST_RATE;
  const gstRate = rawGstRate > 1 ? rawGstRate / 100 : rawGstRate;
  const gstAmount = baseFee * gstRate;
  return {
    baseFee,
    gstAmount,
    totalFee: baseFee + gstAmount
  };
}
