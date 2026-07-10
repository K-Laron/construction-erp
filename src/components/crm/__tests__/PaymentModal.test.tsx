import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PaymentModal from '../PaymentModal';
import type { Customer } from '@/types';

vi.mock('@/app/actions/customers', () => ({
  recordPayment: vi.fn()
}));

describe('PaymentModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    render(
      <PaymentModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSuccess={mockOnSuccess}
        customer={{ id: 'c1', name: 'John Doe', current_balance: 1000 } as unknown as Customer}
      />
    );
    
    expect(screen.getByText(/Receive Cash Payment/i)).toBeTruthy();
  });
});
