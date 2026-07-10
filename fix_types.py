import re
import os

# Define replacements for specific files
replacements = {
    "src/app/actions/customers.ts": [
        (r'as any\[\];', r'as Customer[];'),
        (r'return rows\.map\(r => \(\{\n\s*\.\.\.r,\n\s*phone: r\.phone \? decryptField\(r\.phone, secret\) : null,\n\s*address: r\.address \? decryptField\(r\.address, secret\) : null\n\s*\}\)\);',
         r'''return rows.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone ? decryptField(r.phone, secret) : null,
    address: r.address ? decryptField(r.address, secret) : null,
    credit_limit: r.credit_limit,
    current_balance: r.current_balance,
    price_tier: r.price_tier,
    is_vat_exempt: r.is_vat_exempt,
    is_active: r.is_active,
    created_at: r.created_at
  }));''')
    ],
    "src/app/actions/deliveries.ts": [
        (r'export async function getPendingDeliveries\(\): Promise<any\[\]> {', r'export async function getPendingDeliveries(): Promise<{ transaction_id: string, date: string, delivery_status: string, customer_name: string | null, customer_id: string | null, total_amount: number }[]> {'),
        (r'export async function getDeliveryRemainingItems\(transactionId: string\): Promise<any\[\]> {', r'export async function getDeliveryRemainingItems(transactionId: string): Promise<{ item_id: string, item_name: string, unit: string, ordered_qty: number, delivered_qty: number, remaining_qty: number }[]> {'),
        (r'\)\.all\(transactionId, transactionId\);', r').all(transactionId, transactionId) as { item_id: string, item_name: string, unit: string, ordered_qty: number, delivered_qty: number, remaining_qty: number }[];'),
        (r'export async function getDeliveryHistory\(transactionId: string\): Promise<any\[\]> {', r'export async function getDeliveryHistory(transactionId: string): Promise<{ id: string, transaction_id: string, delivery_date: string, driver_name: string, truck_plate: string, status: string, items: any[] }[]> {'),
        (r'as any\[\];', r'as { id: string, transaction_id: string, delivery_date: string, driver_name: string, truck_plate: string, status: string }[];', 1),
        (r'as any\[\];', r'as { id: string, delivery_id: string, item_id: string, quantity_delivered: number, item_name: string, unit: string }[];')
    ],
    "src/app/actions/inventory.ts": [
        (r'as any\[\];', r'as { id: string, name: string, category: string, unit: string, stock_quantity: number, cost_price: number, selling_price: number, wholesale_price: number, reorder_level: number, is_active: number }[];', 1),
        (r'as any\[\];', r'as { id: string, purchase_order_id: string, item_id: string, quantity: number, unit_price: number, total_price: number }[];')
    ],
    "src/app/actions/ledger.ts": [
        (r'as any\[\];', r'as { id: string, code: string, name: string, category: string, balance: number }[];'),
        (r'as any\[\];', r'as { id: string, journal_entry_id: string, account_id: string, type: string, amount: number, account_name: string, account_code: string, date: string, description: string }[];')
    ],
    "src/app/actions/shifts.ts": [
        (r'export async function getActiveShift\(\): Promise<any> {', r'export async function getActiveShift(): Promise<{ id: string, cashier_id: string, start_time: string, starting_cash: number, status: string } | undefined> {'),
        (r'as any;', r'as { id: string, cashier_id: string, start_time: string, starting_cash: number, status: string } | undefined;')
    ]
}

for filepath, reps in replacements.items():
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r') as f:
        content = f.read()
    for count, r in enumerate(reps):
        if len(r) == 3:
            content = re.sub(r[0], r[1], content, count=r[2])
        else:
            content = re.sub(r[0], r[1], content)
    with open(filepath, 'w') as f:
        f.write(content)

print("Types updated")
