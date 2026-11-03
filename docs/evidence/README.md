# Evidence

This directory holds raw output from real protocol probes and the production smoke test. It is kept so the claims in `docs/TECHNICAL_RESEARCH.md` and `docs/TEST_REPORT.md` can be checked against the actual run rather than taken on trust.

| File             | What it is                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `probe-out.txt`  | Console log from the first protocol probe (token shapes, direct key, async tools)              |
| `probe-out2.txt` | Console log from the constrained-endpoint probe (ephemeral token, tool round trip, single-use) |
| `probe-out3.txt` | Control probes for extended thinking (no tools, minimal tool, scheduling variants)             |
| `smoke-live.log` | Production-path smoke test through the built bridge                                            |

Related structured results live one level up:

- `docs/probe-results.json`
- `docs/probe-results-2.json`
- `docs/probe-results-3.json`

## Handling

These files can contain model transcripts and timing data. They do **not** contain the API key, the gate secret, or ephemeral tokens: the probe scripts print only a masked key and never print credentials.

Treat new evidence as potentially sensitive until reviewed. Do not add logs that print request headers, tokens, or page content without redaction.

## Reproducing

```powershell
node scripts/probe-live.mjs
node scripts/probe-extended.mjs
node scripts/probe-ext-wait.mjs
npm run smoke:live
```

The probes write their structured results to `docs/probe-results*.json`. The smoke test appends a timestamped run to its console output; capture it with `Tee-Object` if you want a fresh log.
