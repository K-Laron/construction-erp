const fs = require('fs');

let txFile = fs.readFileSync('src/app/actions/transactions.ts', 'utf8');
txFile = txFile.replace(
  /export async function processCheckout\(payload: any\): Promise<string> \{/g,
  `export async function processCheckout(payload: any): Promise<{ success: boolean; data?: string; error?: string }> {
  try {`
);
txFile = txFile.replace(
  /    return transactionId;\n\s*\}/,
  `    return { success: true, data: transactionId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Checkout failed' };
  }
}`
);
fs.writeFileSync('src/app/actions/transactions.ts', txFile);

let modalFile = fs.readFileSync('src/components/pos/CheckoutModal.tsx', 'utf8');
modalFile = modalFile.replace(
  /      const result = await processCheckout\(payload\);\n      setSuccessData\(result\);\n      onSuccess\(\{ \.\.\.result, payload \}\);\n    \} catch \(err: any\) \{/,
  `      const result = await processCheckout(payload);
      if (!result.success) {
        throw new Error(result.error);
      }
      setSuccessData(result.data!);
      onSuccess({ ...result.data, payload });
    } catch (err: any) {`
);
fs.writeFileSync('src/components/pos/CheckoutModal.tsx', modalFile);
console.log('Fixed Checkout');
