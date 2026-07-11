import { describe, it, expect } from 'vitest';
import { formatCurrency, parsePesoCentavos, formatQuantity, parseMillicounts, formatDate, formatDateTime } from '../format';

describe('formatCurrency', () => {
  it('formats centavos to PHP string', () => {
    expect(formatCurrency(25000)).toBe('₱250.00');
    expect(formatCurrency(0)).toBe('₱0.00');
    expect(formatCurrency(99)).toBe('₱0.99');
    expect(formatCurrency(100)).toBe('₱1.00');
    expect(formatCurrency(1234567)).toBe('₱12,345.67');
  });
});

describe('parsePesoCentavos', () => {
  it('parses peso string to centavos integer', () => {
    expect(parsePesoCentavos('250.00')).toBe(25000);
    expect(parsePesoCentavos('0')).toBe(0);
    expect(parsePesoCentavos('0.99')).toBe(99);
    expect(parsePesoCentavos('invalid')).toBe(0);
  });
});

describe('formatQuantity', () => {
  it('formats millicounts to human-readable quantity', () => {
    expect(formatQuantity(1000)).toBe('1');
    expect(formatQuantity(4250)).toBe('4.25');
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(1)).toBe('0.001');
    expect(formatQuantity(3333)).toBe('3.333');
    expect(formatQuantity(1500000)).toBe('1500');
  });
});

describe('parseMillicounts', () => {
  it('parses quantity string to millicounts integer', () => {
    expect(parseMillicounts('1')).toBe(1000);
    expect(parseMillicounts('4.25')).toBe(4250);
    expect(parseMillicounts('0')).toBe(0);
    expect(parseMillicounts('0.001')).toBe(1);
    expect(parseMillicounts('invalid')).toBe(0);
  });
});

describe('formatDate', () => {
  it('formats date string for display', () => {
    const result = formatDate('2026-07-11');
    expect(result).toContain('Jul');
    expect(result).toContain('2026');
  });

  it('returns Invalid Date string for unparseable input', () => {
    expect(formatDate('')).toBe('Invalid Date');
    expect(formatDate('garbage')).toBe('Invalid Date');
  });
});

describe('formatDateTime', () => {
  it('formats date+time string for display', () => {
    const result = formatDateTime('2026-07-11T03:00:00');
    expect(result).toContain('Jul');
    expect(result).toContain('2026');
    expect(result).toMatch(/03:00|3:00/);
  });

  it('returns Invalid Date string for unparseable input', () => {
    expect(formatDateTime('')).toBe('Invalid Date');
    expect(formatDateTime('garbage')).toBe('Invalid Date');
  });
});
