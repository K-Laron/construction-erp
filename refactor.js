const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const mlekContent = `export function getMlekSecret(): Buffer {
  const secret = (global as any).mlekSecret;
  if (!secret) throw new Error("DATABASE_LOCKED: Store is locked.");
  return secret;
}

export function checkMlek(): void {
  if (!(global as any).mlekSecret) throw new Error("DATABASE_LOCKED: Store is locked.");
}

export function setMlekSecret(secret: Buffer | null): void {
  (global as any).mlekSecret = secret;
}

export function isMlekUnlocked(): boolean {
  return !!(global as any).mlekSecret;
}
`;
fs.writeFileSync(path.join(srcDir, 'lib', 'mlek.ts'), mlekContent);

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.ts') || file.endsWith('.tsx')) results.push(file);
    }
  });
  return results;
}

const files = walk(srcDir);

for (const file of files) {
  if (file.endsWith('lib/mlek.ts')) continue;
  
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  const checkMlekDef = /function checkMlek\(\): void {\n  if \(!\(global as any\).mlekSecret\) \{?\n    throw new Error\("DATABASE_LOCKED: Store is locked."\);\n  \}?\n}\n?/g;
  if (content.match(checkMlekDef)) {
    content = content.replace(checkMlekDef, '');
    changed = true;
  }
  const checkMlekDef2 = /function checkMlek\(\): void {\n  if \(!\(global as any\).mlekSecret\) throw new Error\("DATABASE_LOCKED: Store is locked."\);\n}\n?/g;
  if (content.match(checkMlekDef2)) {
    content = content.replace(checkMlekDef2, '');
    changed = true;
  }
  const checkMlekDef3 = /function checkMlek\(\) \{[\s\S]*?\n\}\n?/g;
  if (content.includes('function checkMlek()') && file.includes('transactions.ts')) {
      content = content.replace(/function checkMlek\(\) \{[\s\S]*?\n\}\n?/, '');
      changed = true;
  }

  if (content.includes('(global as any).mlekSecret')) {
    content = content.replace(/\(global as any\)\.mlekSecret = null/g, 'setMlekSecret(null)');
    content = content.replace(/\(global as any\)\.mlekSecret = ([^;]+)/g, 'setMlekSecret($1)');
    content = content.replace(/!!\(global as any\)\.mlekSecret/g, 'isMlekUnlocked()');
    content = content.replace(/\(global as any\)\.mlekSecret/g, 'getMlekSecret()');
    changed = true;
  }

  if (changed || content.includes('checkMlek') || content.includes('getMlekSecret') || content.includes('setMlekSecret') || content.includes('isMlekUnlocked')) {
    const needsImport = (content.includes('checkMlek') && !content.includes('function checkMlek')) || 
                        content.includes('getMlekSecret') || 
                        content.includes('setMlekSecret') || 
                        content.includes('isMlekUnlocked');
    if (needsImport && !content.includes('from "@/lib/mlek"')) {
      let importStr = 'import { getMlekSecret, checkMlek, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";\n';
      const lastImportIndex = content.lastIndexOf('import ');
      if (lastImportIndex !== -1) {
        const endOfLine = content.indexOf('\n', lastImportIndex);
        content = content.substring(0, endOfLine + 1) + importStr + content.substring(endOfLine + 1);
      } else {
        content = importStr + content;
      }
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}
