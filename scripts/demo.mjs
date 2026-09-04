// One-command demo bootstrap: migrate + seed, then print the checklist.
// Run from the repo root: `pnpm demo`. Uses only node stdlib.
import { spawnSync } from "node:child_process";

process.loadEnvFile?.(".env");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\nDEMO FAILED at: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

run("pnpm", ["--filter", "@razorpay-recovery/api", "db:migrate"]);
run("pnpm", ["--filter", "@razorpay-recovery/api", "db:seed"]);

console.log(`
DEMO READY
  API:       pnpm --filter @razorpay-recovery/api dev   (http://localhost:3000/health)
  Dashboard: pnpm --filter @razorpay-recovery/web dev   (http://localhost:5173)
  Fire traffic:
    pnpm --filter @razorpay-recovery/api simulate:failed
    pnpm --filter @razorpay-recovery/api simulate:abandoned
    pnpm --filter @razorpay-recovery/api simulate:receivables
  Walkthrough: DEMO_SCRIPT.md (local-only, not committed)
`);
