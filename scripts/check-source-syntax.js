// Parse all typed source, including ambient declarations that transpileModule
// omits. This complements, rather than replaces, the full semantic typecheck.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const files = []
const visit = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) visit(full)
    else if (/\.tsx?$/.test(entry.name)) files.push(full)
  }
}
visit(path.join(root, 'src'))
const failures = []
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  for (const diagnostic of source.parseDiagnostics) {
    const position = source.getLineAndCharacterOfPosition(diagnostic.start || 0)
    failures.push(`${path.relative(root, file)}:${position.line + 1}:${position.character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
  }
}
if (failures.length) throw new Error(failures.join('\n'))
console.log(`PASS syntax parsing: ${files.length} TS/TSX/declaration files`)
