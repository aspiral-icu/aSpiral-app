const fs = require('fs');
const filepath = 'src/lib/breakthrough/selector.ts';
let content = fs.readFileSync(filepath, 'utf8');

// The test expects exact behavior. Let's look at how getRecentVariantIds and getRecentIntensities are implemented in history.ts.
// In history.ts, getRecentVariantIds uses a reverse loop and pushes to `result`. So result[0] is the NEWEST entry.
// Before my changes, `history.entries.slice(-RECENCY_WINDOW).map(...)` returned the OLDEST first (result[0] is oldest, result[last] is newest).
// So reversing the array affects anything relying on index order!
//
// In selector.ts:
// 1. calculateRecencyPenalty:
//    const index = recentVariantIds.indexOf(variantId);
//    return 1 - (index / RECENCY_WINDOW) * 0.9;
//    If index is now reversed (0 = newest, length-1 = oldest).
//    In the old code, newest was index `length-1`. It would give penalty `1 - ((length-1)/10)*0.9`.
//    Wait! `recentVariantIds` was passed in `calculateTotalScore(variant, effectiveContext.recentVariantIds)`
//    Actually, we should just make getRecentVariantIds and getRecentIntensities return chronologically if we want it to match slice().map() without reverse.
//    Wait! In history.ts, there's a comment:
//    // Performance Optimization: Replaced chained .slice().map().reverse() with a single-pass
//    // reverse loop to avoid intermediate array allocations.
//    This means `getRecentVariantIds` ALREADY returns in reverse chronological order (newest first) by design (someone else changed history.ts previously).
//    Wait, let's verify if `slice().map().reverse()` was ever in selector.ts.
