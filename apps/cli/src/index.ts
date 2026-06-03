#!/usr/bin/env bun
import { homedir } from 'node:os'
import { run } from './cli.ts'
import { EXIT } from './exit.ts'
import { captureException, flush, initSentry } from './observability.ts'

initSentry()

const argv = process.argv.slice(2)

let result
try {
  result = await run(argv, {
    homeDir: homedir(),
    readStdin: () => Bun.stdin.text(),
  })
} catch (err) {
  // A throw out of run() is a CLI bug (run() is meant to map every expected failure to a
  // CliResult), so it's the most important thing to report.
  captureException(err, { argv })
  await flush()
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  process.stderr.write(`${JSON.stringify({ error: 'unexpected', message })}\n`)
  process.exit(EXIT.UNEXPECTED)
}

// An UNEXPECTED exit is a server 5xx or an unmapped status — worth reporting from the client
// side too, since the operator running the CLI may not own the API's Sentry project.
if (result.code === EXIT.UNEXPECTED) {
  captureException(new Error(`walnut CLI failed unexpectedly (exit ${result.code})`), {
    argv,
    stderr: result.stderr,
  })
}

if (result.stdout !== '') {
  process.stdout.write(`${result.stdout}\n`)
}
if (result.stderr !== '') {
  process.stderr.write(`${result.stderr}\n`)
}
await flush()
process.exit(result.code)
