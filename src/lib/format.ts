/**
 * Format centavo integer to Philippine Peso display string.
 * Example: 25000 -> "₱250.00"
 */
export function formatCurrency(centavos: number): string {
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Parse peso string input to centavos integer.
 * Example: "250.00" -> 25000
 */
export function parsePesoCentavos(pesoStr: string): number {
  const parsed = parseFloat(pesoStr);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

/**
 * Format millicount integer to human-readable quantity.
 * Example: 4250 -> "4.25", 1000 -> "1"
 */
export function formatQuantity(millicounts: number): string {
  const val = millicounts / 1000;
  return val % 1 === 0 ? val.toFixed(0) : val.toFixed(3).replace(/0+$/, '');
}

/**
 * Parse quantity input to millicounts integer.
 * Example: "4.25" -> 4250, "10" -> 10000
 */
export function parseMillicounts(qtyStr: string): number {
  const parsed = parseFloat(qtyStr);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 1000);
}

/**
 * Format date string for display.
 */
export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format date+time for display.
 */
export function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}
