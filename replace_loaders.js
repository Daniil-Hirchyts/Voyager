const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Find all tsx files with Loader2
const files = execSync('grep -rl "Loader2" frontend/src').toString().trim().split('\n');

files.forEach(file => {
  if (!file || !file.endsWith('.tsx')) return;
  
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace <Loader2 ... /> with <VoyagerLoader ... />
  // We need to keep the props, but remove "animate-spin" as VoyagerLoader handles its own animation
  // Let's replace animate-spin and animate-[spin] etc.
  
  let modified = content;
  
  // Replace the component name
  modified = modified.replace(/<Loader2\b/g, '<VoyagerLoader');
  
  // Some places might use </Loader2>, though it's usually self-closing
  modified = modified.replace(/<\/Loader2>/g, '</VoyagerLoader>');
  
  // Remove "animate-spin" class
  // It could be in a string or clsx/cn
  // Since it's usually className="... animate-spin ..." we can just replace animate-spin with empty string
  modified = modified.replace(/animate-spin/g, '');
  // Fix double spaces
  modified = modified.replace(/className="([^"]*)\s{2,}([^"]*)"/g, 'className="$1 $2"');
  
  // Add import if not present
  if (!modified.includes('VoyagerLoader')) return; // No change
  
  if (!modified.includes("import { VoyagerLoader }")) {
    // Find the last import statement
    const importRegex = /import .* from ['"].*['"];?\n/g;
    let match;
    let lastIndex = 0;
    while ((match = importRegex.exec(modified)) !== null) {
      lastIndex = match.index + match[0].length;
    }
    
    const importStmt = "import { VoyagerLoader } from '@/widgets/app-shell/logo'\n";
    if (lastIndex > 0) {
      modified = modified.slice(0, lastIndex) + importStmt + modified.slice(lastIndex);
    } else {
      modified = importStmt + modified;
    }
  }
  
  // Clean up empty classes like className=" " or className=""
  modified = modified.replace(/className="\s+"/g, 'className=""');
  modified = modified.replace(/className={cn\('([^']*)',\s*''\)}/g, "className={cn('$1')}");

  // Also remove Loader2 from lucide-react imports if it's there
  modified = modified.replace(/Loader2,\s*/g, '');
  modified = modified.replace(/,\s*Loader2/g, '');
  modified = modified.replace(/import { Loader2 } from 'lucide-react'\n/g, '');

  if (content !== modified) {
    fs.writeFileSync(file, modified, 'utf8');
    console.log(`Updated ${file}`);
  }
});
