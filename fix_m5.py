import os
import re
import glob

# Files to process
action_files = glob.glob('src/app/actions/*.ts')

# We want to change the signature of actions that don't already return { success...
def fix_action_files():
    for file in action_files:
        with open(file, 'r') as f:
            content = f.read()

        # Find all export async function definitions
        # that do NOT already have { success: boolean
        pattern = re.compile(r'export async function (\w+)\(([^)]*)\):\s*Promise<([^>]+|[^>]+<[^>]+>[^>]*)>\s*\{')
        
        def replacer(match):
            func_name = match.group(1)
            args = match.group(2)
            ret_type = match.group(3).strip()
            
            if 'success: boolean' in ret_type or func_name in ['openShift', 'closeShift', 'processCheckout', 'recordPayment']:
                return match.group(0)
            
            # Wrap the return type
            new_ret = f"{{ success: boolean; data?: {ret_type}; error?: string }}"
            return f"export async function {func_name}({args}): Promise<{new_ret}> {{"

        new_content = pattern.sub(replacer, content)
        
        # Now we need to manually adjust the bodies of these functions in the typescript files, 
        # but regex might be too brittle for the body.
        
        if content != new_content:
            with open(file, 'w') as f:
                f.write(new_content)
                
if __name__ == '__main__':
    fix_action_files()
