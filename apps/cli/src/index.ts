#!/usr/bin/env bun
import { homedir } from 'node:os'
import { run } from './cli.ts'

const result = await run(process.argv.slice(2), {
  homeDir: homedir(),
  readStdin: () => Bun.stdin.text(),
})

if (result.stdout !== '') {
  process.stdout.write(`${result.stdout}\n`)
}
if (result.stderr !== '') {
  process.stderr.write(`${result.stderr}\n`)
}
process.exit(result.code)
