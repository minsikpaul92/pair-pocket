# Next.js Dev Server Post-Build Rule

## MANDATORY PROCEDURE AFTER RUNNING `npm run build` (`next build`):

1. Whenever `npm run build` (`next build`) is executed to verify TypeScript types or production build:
   - The production build process overwrites `.next` chunks, rendering any active `npm run dev` task stale with `Cannot find module './XXX.js'` errors.

2. **AUTOMATIC CLEANUP AND RESTART REQUIRED**:
   - Immediately after completing `npm run build`:
     a. Kill the existing `npm run dev` task using `manage_task(Action='kill')`.
     b. Clean `.next` if necessary (`rm -rf .next`).
     c. Restart the dev server (`npm run dev`) as a background daemon (`IsDaemon=true`).
     d. Perform runtime verification (`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ko`) to confirm HTTP 200 success.

3. **NEVER** declare work complete to the user without completing step 2.
