import re
import os

replacements = {
    "src/app/actions/auth.ts": [
        (r'Promise<\{ success: boolean; user\?: any; error\?: string \}>', r'Promise<{ success: boolean; user?: { id: string; username: string; name: string; role: string; }; error?: string }>'),
        (r'\.get\(username\) as any;', r'.get(username) as { id: string; username: string; name: string; role: string; passcode_hash: string; passcode_salt: string; } | undefined;'),
        (r'export async function getUsers\(\): Promise<any\[\]>', r'export async function getUsers(): Promise<{ id: string; username: string; name: string; role: string; is_active: number }[]>'),
    ],
    "src/app/actions/transactions.ts": [
        (r'\.get\(transactionId\) as any;', r'.get(transactionId) as { sales_invoice_number?: number; official_receipt_number?: number } | undefined;')
    ],
    "src/app/actions/deliveries.ts": [
        (r'const itemsByDelivery = allItems\.reduce\(\(acc, item\) => \{', r'const itemsByDelivery = allItems.reduce((acc: Record<string, any[]>, item) => {')
    ],
    "src/app/actions/ledger.ts": [
        (r'const allDates = \[...new Set\(\[...salesRows\.map\(r => r\.date\), \.\.\.collectionsRows\.map\(r => r\.date\)\]\)\].sort\(\);', r'const allDates = [...new Set([...salesRows.map((r: any) => r.date), ...collectionsRows.map((r: any) => r.date)])].sort();')
    ],
    "src/app/actions/shifts.ts": [
        (r'export async function getZReading\(shiftId: string\): Promise<any> \{', r'export async function getZReading(shiftId: string): Promise<{ totalSales: number; totalCollections: number; totalReturns: number }> {'),
        (r'\.get\(shiftId\) as any;', r'.get(shiftId) as { total: number } | undefined;'),
        (r'\.get\(shiftId\) as any;', r'.get(shiftId) as { total: number } | undefined;'),
        (r'\.get\(shiftId\) as any;', r'.get(shiftId) as { total: number } | undefined;')
    ],
    "src/lib/mlek.ts": [
        (r'\(global as any\)', r'(global as { __mlekSecret?: Buffer | null })')
    ],
    "src/lib/session.ts": [
        (r'\(global as any\)', r'(global as { __sessionPassword?: string })')
    ]
}

for filepath, reps in replacements.items():
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r') as f:
        content = f.read()
    for r in reps:
        content = re.sub(r[0], r[1], content)
    with open(filepath, 'w') as f:
        f.write(content)

print("More types updated")
