const fs = require('fs');

const path = 'src/lib/breakthrough/history.ts';
let content = fs.readFileSync(path, 'utf8');

const searchBlock = `
  // Performance Optimization: Replaced Array.from(map.entries()).sort() with a direct
  // for...of loop to avoid intermediate array allocations and GC pressure.
  const result: Array<[string, number]> = [];
  for (const entry of counts.entries()) {
    result.push(entry);
  }

  return result
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([id]) => id);
}
`.trim();

const replaceBlock = `
  return Array.from(counts.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([id]) => id);
}
`.trim();

if (content.includes(searchBlock)) {
  content = content.replace(searchBlock, replaceBlock);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Successfully reverted the second modification.');
} else {
  console.log('Could not find the search block in the file.');
}
