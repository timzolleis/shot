/** The review page's entry file, for bundling: `review-page.ts` from source, `review-page.js` when built. */
export const reviewPageEntry = new URL(
  import.meta.url.endsWith('.ts') ? './review-page.ts' : './review-page.js',
  import.meta.url,
).pathname
