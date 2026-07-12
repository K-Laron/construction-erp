const fs = require('fs');
const path = require('path');

const actionsDir = path.join(__dirname, 'src', 'app', 'actions');
const libDir = path.join(__dirname, 'src', 'lib');

function replaceCurrentTimestamp(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceCurrentTimestamp(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const orig = content;
      content = content.replace(/CURRENT_TIMESTAMP/g, `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
      if (content !== orig) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated CURRENT_TIMESTAMP in ${fullPath}`);
      }
    }
  }
}

replaceCurrentTimestamp(actionsDir);
replaceCurrentTimestamp(libDir);

const customersTs = path.join(actionsDir, 'customers.ts');
let customersContent = fs.readFileSync(customersTs, 'utf8');
const guardMatch = customersContent.match(/if\s*\(\s*parsed\.amount\s*>\s*cust\.current_balance\s*\)\s*\{\s*throw new Error\('OVERPAYMENT_NOT_ALLOWED[^;]+;\s*\}/);
if (guardMatch) {
  customersContent = customersContent.replace(guardMatch[0], '// Overpayments are allowed to support credit balances (Phase 4 Audit)');
  fs.writeFileSync(customersTs, customersContent);
  console.log('Removed OVERPAYMENT_NOT_ALLOWED guard in customers.ts');
} else {
  console.log('Could not find OVERPAYMENT guard in customers.ts');
}

// inventory.ts might also have an overpayment guard?
const inventoryTs = path.join(actionsDir, 'inventory.ts');
let inventoryContent = fs.readFileSync(inventoryTs, 'utf8');
const invGuardMatch = inventoryContent.match(/if\s*\(\s*parsed\.amount\s*>\s*supplier\.current_balance\s*\)\s*\{\s*throw new Error\('OVERPAYMENT_NOT_ALLOWED[^;]+;\s*\}/);
if (invGuardMatch) {
  inventoryContent = inventoryContent.replace(invGuardMatch[0], '// Overpayments are allowed to support credit balances');
  fs.writeFileSync(inventoryTs, inventoryContent);
  console.log('Removed OVERPAYMENT_NOT_ALLOWED guard in inventory.ts');
}

