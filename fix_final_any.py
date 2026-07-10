import re
import os

replacements = {
    "src/app/actions/__tests__/auth.test.ts": [
        (r'as any;', r'as { id: string } | undefined;')
    ],
    "src/app/actions/__tests__/inventory.test.ts": [
        (r'as any\[\];', r'as { id: string }[];')
    ],
    "src/app/actions/ledger.ts": [
        (r'as any;', r'as { amount: number } | undefined;'),
        (r'as any\[\];', r'as { id: string; }[];', 2)
    ],
    "src/app/actions/shifts.ts": [
        (r'as any\[\];', r'as { id: string; }[];', 3)
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

print("Final any fixed")
