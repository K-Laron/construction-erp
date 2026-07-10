import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import POSRegister from '../POSRegister';

vi.mock('@/app/actions/inventory', () => ({
  getInventory: vi.fn()
}));
vi.mock('@/app/actions/customers', () => ({
  getCustomers: vi.fn()
}));
vi.mock('@/app/actions/shifts', () => ({
  getCurrentShift: vi.fn()
}));

import { getInventory } from '@/app/actions/inventory';
import { getCustomers } from '@/app/actions/customers';
import { getCurrentShift } from '@/app/actions/shifts';

describe('POSRegister', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error mock
    getInventory.mockResolvedValue([
      { id: '1', name: 'Cement', category: 'Masonry', selling_price: 200, unit: 'bag', stock_quantity: 100, cost_price: 150 }
    ]);
    // @ts-expect-error mock
    getCustomers.mockResolvedValue([
      { id: 'c1', name: 'John Doe', price_tier: 'Retail' }
    ]);
    // @ts-expect-error mock
    getCurrentShift.mockResolvedValue({
      id: 'shift_1',
      cashier_id: 'user_1'
    });
  });

  it('renders correctly and loads inventory', async () => {
    render(<POSRegister />);
    
    await waitFor(() => {
      expect(screen.getByText('Cement')).toBeTruthy();
    });
  });
});
