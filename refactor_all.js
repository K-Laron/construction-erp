const fs = require('fs');

function wrapFunction(file, funcRegex, returnRegex, defaultRet, errMsg) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(funcRegex, (match, def) => {
    return def.replace(/: Promise<.*>/, ': Promise<{ success: boolean; data?: any; error?: string }>') + ' {\n  try {';
  });
  content = content.replace(returnRegex, (match, retExpr) => {
    return `    return { success: true, data: ${retExpr} };\n  } catch (err: unknown) {\n    return { success: false, error: err instanceof Error ? err.message : '${errMsg}' };\n  }\n}`;
  });
  fs.writeFileSync(file, content);
}

// createCustomer
wrapFunction(
  'src/app/actions/customers.ts',
  /(export async function createCustomer\([\s\S]*?isVatExempt: number = 0\n\): Promise<string>) \{/,
  /    return (customerId);\n}/,
  'customerId',
  'Failed to create customer'
);

// recordPayment
wrapFunction(
  'src/app/actions/customers.ts',
  /(export async function recordPayment\([\s\S]*?\): Promise<string>) \{/,
  /    return (ledgerId);\n}/,
  'ledgerId',
  'Failed to record payment'
);

// createProduct
wrapFunction(
  'src/app/actions/inventory.ts',
  /(export async function createProduct\([\s\S]*?\): Promise<string>) \{/,
  /    return (itemId);\n}/,
  'itemId',
  'Failed to create product'
);

// openShift
wrapFunction(
  'src/app/actions/shifts.ts',
  /(export async function openShift\([\s\S]*?\): Promise<string>) \{/,
  /  return (shiftId);\n}/,
  'shiftId',
  'Failed to open shift'
);

// closeShift
wrapFunction(
  'src/app/actions/shifts.ts',
  /(export async function closeShift\([\s\S]*?\): Promise<void>) \{/,
  /  db.prepare\(\"UPDATE shifts SET status = 'Closed', end_time = CURRENT_TIMESTAMP WHERE id = \?\"\).run\(shiftId\);\n}/,
  'undefined;\n  db.prepare("UPDATE shifts SET status = \'Closed\', end_time = CURRENT_TIMESTAMP WHERE id = ?").run(shiftId);',
  'Failed to close shift'
);
// Fix closeShift return
let sf = fs.readFileSync('src/app/actions/shifts.ts', 'utf8');
sf = sf.replace(
  /  undefined;\n  db\.prepare\("UPDATE shifts SET status = 'Closed', end_time = CURRENT_TIMESTAMP WHERE id = \?"\)\.run\(shiftId\);/,
  `  db.prepare("UPDATE shifts SET status = 'Closed', end_time = CURRENT_TIMESTAMP WHERE id = ?").run(shiftId);\n    return { success: true };`
);
fs.writeFileSync('src/app/actions/shifts.ts', sf);

// dispatchDelivery
wrapFunction(
  'src/app/actions/deliveries.ts',
  /(export async function dispatchDelivery\([\s\S]*?\): Promise<string>) \{/,
  /    return (deliveryId);\n  \}\);\n\n  return deliveryId;\n}/,
  'deliveryId',
  'Failed to dispatch'
);
// Fix dispatchDelivery
let df = fs.readFileSync('src/app/actions/deliveries.ts', 'utf8');
df = df.replace(
  /    return \{ success: true, data: deliveryId \};\n  \} catch \(err: unknown\) \{\n    return \{ success: false, error: err instanceof Error \? err\.message : 'Failed to dispatch' \};\n  \}\n\}\);\n\n  return deliveryId;/,
  `  });\n\n    return { success: true, data: deliveryId };\n  } catch (err: unknown) {\n    return { success: false, error: err instanceof Error ? err.message : 'Failed to dispatch' };\n  }\n`
);
fs.writeFileSync('src/app/actions/deliveries.ts', df);


function fixComponent(file, actionCallRegex, successDataVar) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(actionCallRegex, (match, prefix, call) => {
    return `${prefix}${call}\n      if (!result.success) throw new Error(result.error);\n`;
  });
  if (successDataVar) {
    content = content.replace(new RegExp(`setSuccessData\\(result\\);`, 'g'), `setSuccessData(result.data);`);
  }
  fs.writeFileSync(file, content);
}

// Update UI
fixComponent('src/components/crm/CustomerFormModal.tsx', /(      const result = )(await createCustomer\([\s\S]*?\);)/, false);
fixComponent('src/components/crm/PaymentModal.tsx', /(      const result = )(await recordPayment\([\s\S]*?\);)/, false);
fixComponent('src/components/inventory/ProductFormModal.tsx', /(      await )(createProduct\([\s\S]*?\);)/, false);
fixComponent('src/components/pos/ShiftBar.tsx', /(      await )(openShift\([\s\S]*?\);)/, false);
fixComponent('src/components/pos/ShiftBar.tsx', /(      await )(closeShift\([\s\S]*?\);)/, false);
fixComponent('src/components/deliveries/DispatchModal.tsx', /(      const result = )(await dispatchDelivery\([\s\S]*?\);)/, false);

// Need to change `const result = await dispatchDelivery` to `const result` in ShiftBar and Product if we want to check result.success, 
// wait, `await createProduct` in ProductFormModal has no variable!
let pf = fs.readFileSync('src/components/inventory/ProductFormModal.tsx', 'utf8');
pf = pf.replace(/      await\n      if \(!result\.success\) throw new Error\(result\.error\);\ncreateProduct\([\s\S]*?\);\n/g, ''); // undo the broken one
pf = pf.replace(/      await createProduct\(([\s\S]*?)\);/g, `      const result = await createProduct($1);\n      if (!result.success) throw new Error(result.error);`);
fs.writeFileSync('src/components/inventory/ProductFormModal.tsx', pf);

let sb = fs.readFileSync('src/components/pos/ShiftBar.tsx', 'utf8');
sb = sb.replace(/      await\n      if \(!result\.success\) throw new Error\(result\.error\);\nopenShift\([\s\S]*?\);\n/g, '');
sb = sb.replace(/      await openShift\(([\s\S]*?)\);/g, `      const result = await openShift($1);\n      if (!result.success) throw new Error(result.error);`);
sb = sb.replace(/      await\n      if \(!result\.success\) throw new Error\(result\.error\);\ncloseShift\([\s\S]*?\);\n/g, '');
sb = sb.replace(/      await closeShift\(([\s\S]*?)\);/g, `      const result = await closeShift($1);\n      if (!result.success) throw new Error(result.error);`);
fs.writeFileSync('src/components/pos/ShiftBar.tsx', sb);

console.log('UI and Actions Refactored');
