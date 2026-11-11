#!/usr/bin/env node
/**
 * Master E2E Test Runner for Kimi K3 Autonomous Bridge
 * Executes all 4 E2E test tiers, formats structured test results,
 * and exits with code 0 on success or 1 on failure.
 *
 * Usage:
 *   node tests/e2e/test-runner.mjs
 *   node tests/e2e/test-runner.mjs tier1
 *   node tests/e2e/test-runner.mjs tier2
 *   node tests/e2e/test-runner.mjs tier3
 *   node tests/e2e/test-runner.mjs tier4
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tier modules registry
const TIERS = [
  { id: 'tier1', name: 'Tier 1: Feature Coverage', file: './tier1_feature_coverage.test.mjs' },
  {
    id: 'tier2',
    name: 'Tier 2: Boundary & Corner Cases',
    file: './tier2_boundary_corner.test.mjs',
  },
  {
    id: 'tier3',
    name: 'Tier 3: Cross-Feature Combinations',
    file: './tier3_cross_feature.test.mjs',
  },
  { id: 'tier4', name: 'Tier 4: Real-World Workload Scenarios', file: './tier4_workload.test.mjs' },
  { id: 'tier5', name: 'Tier 5: Adversarial Hardening', file: './tier5_adversarial.test.mjs' },
  {
    id: 'tier5_proto',
    name: 'Tier 5: Adversarial Protocol',
    file: './tier5_adversarial_protocol.test.mjs',
  },
];

async function main() {
  const args = process.argv.slice(2).map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const selectedTiers =
    args.length > 0
      ? TIERS.filter((t) => args.some((arg) => t.id === arg || t.name.toLowerCase().includes(arg)))
      : TIERS;

  if (selectedTiers.length === 0) {
    console.error(
      `Unknown tier filter: "${process.argv.slice(2).join(' ')}". Available: tier1, tier2, tier3, tier4, tier5`,
    );
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('   GEMATRON KIMI K3 AUTONOMOUS BRIDGE - E2E TEST SUITE RUNNER');
  console.log('='.repeat(80));
  console.log(`Node Engine   : ${process.version}`);
  console.log(`Execution Dir : ${process.cwd()}`);
  console.log(`Active Tiers  : ${selectedTiers.map((t) => t.id.toUpperCase()).join(', ')}`);
  console.log('-'.repeat(80) + '\n');

  const suiteStart = Date.now();
  const summary = [];
  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;

  for (const tier of selectedTiers) {
    console.log(`>>> Running [${tier.id.toUpperCase()}] ${tier.name}...`);
    const tierStart = Date.now();
    let results = [];
    let loadError = null;

    try {
      const modulePath = path.resolve(__dirname, tier.file);
      const mod = await import(`file://${modulePath}`);
      if (typeof mod.run !== 'function') {
        throw new Error(`Test module ${tier.file} does not export a run() function.`);
      }
      results = await mod.run();
    } catch (err) {
      loadError = err;
    }

    if (loadError) {
      console.log(`  [FAIL] Failed to execute ${tier.name}: ${loadError.message}\n`);
      totalTests++;
      totalFail++;
      summary.push({
        id: tier.id.toUpperCase(),
        name: tier.name,
        total: 1,
        passed: 0,
        failed: 1,
        durationMs: Date.now() - tierStart,
      });
      continue;
    }

    let tierPass = 0;
    let tierFail = 0;

    for (const r of results) {
      totalTests++;
      if (r.status === 'pass') {
        totalPass++;
        tierPass++;
        console.log(`  [PASS] ${r.name} (${r.durationMs}ms)`);
      } else {
        totalFail++;
        tierFail++;
        console.log(`  [FAIL] ${r.name} (${r.durationMs}ms)`);
        if (r.error) {
          const errMsg = r.error.stack || r.error.message || String(r.error);
          console.log(`         ERROR: ${errMsg.split('\n')[0]}`);
        }
      }
    }

    const tierDuration = Date.now() - tierStart;
    summary.push({
      id: tier.id.toUpperCase(),
      name: tier.name,
      total: results.length,
      passed: tierPass,
      failed: tierFail,
      durationMs: tierDuration,
    });

    console.log(
      `   -> ${tier.name} completed: ${tierPass}/${results.length} passed (${tierDuration}ms)\n`,
    );
  }

  const totalSuiteDuration = Date.now() - suiteStart;

  // Render Summary Scorecard
  console.log('='.repeat(80));
  console.log('                      E2E TEST SUITE SCORECARD');
  console.log('='.repeat(80));
  console.log(
    'Tier'.padEnd(10) +
      'Total'.padEnd(10) +
      'Passed'.padEnd(10) +
      'Failed'.padEnd(10) +
      'Status'.padEnd(12) +
      'Duration',
  );
  console.log('-'.repeat(80));

  for (const s of summary) {
    const statusStr = s.failed === 0 ? '✓ PASS' : '✗ FAIL';
    console.log(
      s.id.padEnd(10) +
        String(s.total).padEnd(10) +
        String(s.passed).padEnd(10) +
        String(s.failed).padEnd(10) +
        statusStr.padEnd(12) +
        `${s.durationMs}ms`,
    );
  }

  console.log('-'.repeat(80));
  const finalStatus = totalFail === 0 ? 'ALL TIERS PASSED' : 'SOME TESTS FAILED';
  console.log(
    'TOTAL'.padEnd(10) +
      String(totalTests).padEnd(10) +
      String(totalPass).padEnd(10) +
      String(totalFail).padEnd(10) +
      (totalFail === 0 ? '✓ PASS' : '✗ FAIL').padEnd(12) +
      `${totalSuiteDuration}ms`,
  );
  console.log('='.repeat(80));
  console.log(
    `Final Outcome: ${finalStatus} (${totalPass}/${totalTests} tests passing in ${totalSuiteDuration}ms)`,
  );
  console.log('='.repeat(80) + '\n');

  if (totalFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
