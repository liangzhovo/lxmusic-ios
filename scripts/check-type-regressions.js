// Full-project TypeScript comparison against the unchanged build baseline.
// Existing diagnostics remain visible; any added diagnostic fails the build.
require('./check-source-syntax')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const root = path.resolve(__dirname, '..')
const baseline = '3f008d3599f29ceeaf7925e5935882a78a3052ff'
const baseDir = path.join(root, 'build', 'typecheck-base')
const logs = path.join(root, 'build', 'checks')
fs.mkdirSync(logs, { recursive: true })
const git = args => cp.execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })
const tsc = require.resolve('typescript/bin/tsc')
const diagnostics = (cwd, label) => {
  const result = cp.spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '--incremental', 'false'], {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000,
  })
  const output = (result.stdout || '') + (result.stderr || '')
  fs.writeFileSync(path.join(logs, `typescript-${label}.log`), output)
  if (result.error || result.signal || (result.status !== 0 && !/error TS\d+:/.test(output))) {
    throw new Error(`TypeScript ${label} could not run: ${result.error || result.signal || output}`)
  }
  const items = []
  for (const line of output.split(/\r?\n/)) {
    if (/error TS\d+:/.test(line)) items.push(line.replace(/\(\d+,\d+\): error /, ': error '))
    else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += '\n' + line
  }
  return items
}
let added = []
try {
  git(['worktree', 'add', '--detach', baseDir, baseline])
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(baseDir, 'node_modules'), 'dir')
  const oldItems = diagnostics(baseDir, 'baseline')
  const newItems = diagnostics(root, 'current')
  const available = new Map()
  for (const item of oldItems) available.set(item, (available.get(item) || 0) + 1)
  for (const item of newItems) {
    const remaining = available.get(item) || 0
    if (remaining) available.set(item, remaining - 1)
    else added.push(item)
  }
  const report = `Baseline diagnostics: ${oldItems.length}\nCurrent diagnostics: ${newItems.length}\nAdded diagnostics: ${added.length}\n` + added.join('\n\n') + '\n'
  fs.writeFileSync(path.join(logs, 'typescript-regressions.txt'), report)
  console.log(report)
} finally {
  if (fs.existsSync(baseDir)) git(['worktree', 'remove', '--force', baseDir])
}
if (added.length || fs.readFileSync(path.join(logs, 'typescript-current.log'), 'utf8').includes('error TS')) process.exitCode = 1
