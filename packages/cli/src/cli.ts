#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { run } from './run'

async function prompt(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  prompt: process.stdin.isTTY && process.stdout.isTTY ? prompt : undefined,
})
