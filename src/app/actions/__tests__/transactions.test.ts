import { describe, it, expect, beforeAll } from 'vitest';
import { processCheckout } from '../transactions';
import { getInventory } from '../inventory';
import { authenticateUser } from '../auth';

describe('Transaction Server Actions', () => {

  it('rejects tampered checkout payloads with incorrect math', async () => {
    const fakePayload = {
      customerId: null,
      items: [
        { itemId: 'item-blocks-4', name: 'Hollow Block 4"', quantity: 1000, unitUsed: 'pc', unitPrice: 2000, unitCost: 1500, totalPrice: 2000 }
      ],
      subtotal: 5000, // Deliberately tampered subtotal to be larger than sum of items (2000)
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 5000,
      amountPaid: 5000,
      paymentMethod: 'Cash' as const
    };

    await expect(processCheckout(fakePayload)).rejects.toThrow(/MATH_TAMPERING_DETECTED/);
  });
});
