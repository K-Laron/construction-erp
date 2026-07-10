import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CheckoutModal from '../CheckoutModal';

// Mock the server action
vi.mock('@/app/actions/transactions', () => ({
  processCheckout: vi.fn()
}));

import { processCheckout } from '@/app/actions/transactions';

describe('CheckoutModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();
  const mockCartItems = [
    { itemId: '1', name: 'Cement', quantity: 2, unitUsed: 'bag', unitPrice: 200, unitCost: 150, totalPrice: 400 }
  ];
  const mockTotals = {
    subtotal: 400,
    tax: 48,
    deliveryFee: 0,
    discount: 0,
    totalAmount: 448
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with cash payment selected by default', () => {
    render(
      <CheckoutModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSuccess={mockOnSuccess}
        cartItems={mockCartItems}
        totals={mockTotals}
        cashierId="user_1"
      />
    );
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('Amount Received')).toBeTruthy();
  });

  it('submits checkout successfully', async () => {
    (processCheckout as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { transactionId: 'tx123', siNumber: 1, orNumber: 1 }
    });

    render(
      <CheckoutModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSuccess={mockOnSuccess}
        cartItems={mockCartItems}
        totals={mockTotals}
        cashierId="user_1"
      />
    );

    const amountInput = screen.getByPlaceholderText('Enter cash received...');
    fireEvent.change(amountInput, { target: { value: '500' } });

    const completeBtn = screen.getByRole('button', { name: /Process Transaction/i });
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(processCheckout).toHaveBeenCalled();
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });
});
