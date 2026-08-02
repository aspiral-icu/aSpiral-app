const fs = require('fs');

const path = 'src/lib/breakthrough/history.ts';
let content = fs.readFileSync(path, 'utf8');

const searchBlock = `
  return Array.from(counts.entries())
    .map(([variantId, count]) => ({ variantId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get the least used variants (for novelty)
 */
export function getLeastUsedVariantIds(allVariantIds: string[], limit: number = 5): string[] {
  const history = getBreakthroughHistory();
  const counts = new Map<string, number>();

  // Initialize all variants with 0
  for (const id of allVariantIds) {
    counts.set(id, 0);
  }

  // Count usage
  for (const entry of history.entries) {
    if (counts.has(entry.variantId)) {
      counts.set(entry.variantId, (counts.get(entry.variantId) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([id]) => id);
}
`.trim();

const replaceBlock = `
  // Performance Optimization: Replaced Array.from(map.entries()).map() with a direct
  // for...of loop to avoid intermediate array allocations and GC pressure.
  const result: Array<{ variantId: string; count: number }> = [];
  for (const [variantId, count] of counts.entries()) {
    result.push({ variantId, count });
  }

  return result
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get the least used variants (for novelty)
 */
export function getLeastUsedVariantIds(allVariantIds: string[], limit: number = 5): string[] {
  const history = getBreakthroughHistory();
  const counts = new Map<string, number>();

  // Initialize all variants with 0
  for (const id of allVariantIds) {
    counts.set(id, 0);
  }

  // Count usage
  for (const entry of history.entries) {
    if (counts.has(entry.variantId)) {
      counts.set(entry.variantId, (counts.get(entry.variantId) || 0) + 1);
    }
  }

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

if (content.includes(searchBlock)) {
  content = content.replace(searchBlock, replaceBlock);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Successfully updated the file.');
} else {
  console.log('Could not find the search block in the file.');
}
