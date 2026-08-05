const fs = require('fs');
const filepath = 'src/lib/breakthrough/selector.ts';
let content = fs.readFileSync(filepath, 'utf8');

// I should implement getRecentVariantIdsChronological and getRecentIntensitiesChronological in selector.ts, or just inline the for loops!
// The history.ts functions return reverse chronological. But selector.ts expects chronological order (slice().map()).
// So the best solution is to inline the chronological extraction in selector.ts using a standard for loop without reverse!

const search1 = `  // Extract recent variant IDs and intensities from history
  const recentVariantIds = getRecentVariantIds(RECENCY_WINDOW);
  const recentIntensities = getRecentIntensities(FATIGUE_CONFIG.fatigueWindow);`;

const replace1 = `  // Extract recent variant IDs and intensities from history
  const recencyStart = Math.max(0, history.entries.length - RECENCY_WINDOW);
  const recentVariantIds = new Array(history.entries.length - recencyStart);
  for (let i = recencyStart; i < history.entries.length; i++) {
    recentVariantIds[i - recencyStart] = history.entries[i].variantId;
  }

  const fatigueStart = Math.max(0, history.entries.length - FATIGUE_CONFIG.fatigueWindow);
  const recentIntensities = new Array(history.entries.length - fatigueStart);
  for (let i = fatigueStart; i < history.entries.length; i++) {
    recentIntensities[i - fatigueStart] = history.entries[i].intensity;
  }`;

content = content.replace(search1, replace1);

const search2 = `  const effectiveContext: SelectionContext = {
    ...context,
    recentVariantIds: getRecentVariantIds(RECENCY_WINDOW),
    recentIntensities: getRecentIntensities(FATIGUE_CONFIG.fatigueWindow),
  };`;

const replace2 = `  const recencyStart = Math.max(0, history.entries.length - RECENCY_WINDOW);
  const recentVariantIds = new Array(history.entries.length - recencyStart);
  for (let i = recencyStart; i < history.entries.length; i++) {
    recentVariantIds[i - recencyStart] = history.entries[i].variantId;
  }

  const fatigueStart = Math.max(0, history.entries.length - FATIGUE_CONFIG.fatigueWindow);
  const recentIntensities = new Array(history.entries.length - fatigueStart);
  for (let i = fatigueStart; i < history.entries.length; i++) {
    recentIntensities[i - fatigueStart] = history.entries[i].intensity;
  }

  const effectiveContext: SelectionContext = {
    ...context,
    recentVariantIds,
    recentIntensities,
  };`;

content = content.replace(search2, replace2);

const importSearch = `import { getBreakthroughHistory, type BreakthroughHistory, getRecentVariantIds, getRecentIntensities } from './history';`;
const importReplace = `import { getBreakthroughHistory, type BreakthroughHistory } from './history';`;
content = content.replace(importSearch, importReplace);

fs.writeFileSync(filepath, content);
console.log('Reverted to inlined chronological loops');
