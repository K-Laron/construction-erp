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
  const mockOnCheckoutSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getInventory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '1', name: 'Cement', category: 'Masonry', selling_price: 200, unit: 'bag', stock_quantity: 100, cost_price: 150 }
    ]);
    (getCustomers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', name: 'John Doe', price_tier: 'Retail' }
    ]);
    (getCurrentShift as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'shift_1',
      cashier_id: 'user_1'
    });
  });

  it('renders correctly and loads inventory', async () => {
    render(<POSRegister cashierId="user_1" onCheckoutSuccess={mockOnCheckoutSuccess} />);
    
    await waitFor(() => {
      expect(screen.getByText('Cement')).toBeTruthy();
    });
  });
});
