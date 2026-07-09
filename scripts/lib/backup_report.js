#!/usr/bin/env node
/*
 * Pretty-printer for the backup CLI's JSON report (#378).
 *
 * The in-pod backup CLI emits a single machine-readable JSON line so callers can
 * parse it. This host-side helper turns that into a readable, coloured summary
 * for the wizard/deploy scripts. It runs on the HOST, so it works regardless of
 * the pod image version — it only depends on the (stable) report shape.
 *
 * Reads stdin, passes any non-JSON lines through unchanged (so Nest logs still
 * appear), and renders an {ok, report} import line — or an {ok, filename} export
 * line — as a table.
 *
 *   kubectl exec ... backup.cli.js import ... | node backup_report.js
 */
const isTTY = process.stdout.isTTY
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = (s) => c('32', s)
const red = (s) => c('31', s)
const yellow = (s) => c('33', s)
const bold = (s) => c('1', s)
const dim = (s) => c('2', s)
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (buf += d))
process.stdin.on('end', () => {
  for (const line of buf.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    let obj
    try {
      obj = JSON.parse(t)
    } catch {
      console.log(line) // not JSON (e.g. a Nest log line) — pass through
      continue
    }
    if (obj && obj.report) printReport(obj.report)
    else if (obj && obj.ok && obj.filename) printExport(obj)
    else console.log(line)
  }
})

function printReport(r) {
  const tables = r.tables || []
  const totalRows = tables.reduce((a, t) => a + (t.actual || 0), 0)
  const okCount = tables.filter((t) => t.match).length
  const allOk = okCount === tables.length
  const p = r.packages || { expected: 0, restored: 0, missingOnDisk: [] }
  const warns = r.warnings || []
  const orphans = r.orphanPackagePaths || []

  const nameW = Math.max(5, ...tables.map((t) => t.name.length))
  const rule = '─'.repeat(nameW + 3 + 10 + 3 + 10 + 3)

  console.log()
  console.log('  ' + bold('Restore report'))
  console.log('  ' + dim(rule))
  console.log(
    '  Encryption key : ' +
      (r.keyStatus === 'match' ? green('match') : yellow(r.keyStatus)),
  )
  const pkgStr = `${p.restored}/${p.expected} restored`
  console.log(
    '  Packages       : ' +
      (p.missingOnDisk && p.missingOnDisk.length ? yellow(pkgStr) : pkgStr),
  )
  console.log(
    '  Warnings       : ' + (warns.length ? yellow(String(warns.length)) : dim('none')),
  )
  console.log()
  console.log(
    '  ' +
      bold(
        'Table'.padEnd(nameW) +
          '   ' +
          'Expected'.padStart(10) +
          '   ' +
          'Restored'.padStart(10),
      ),
  )
  console.log('  ' + dim(rule))
  for (const t of tables) {
    const mark = t.match ? green('✓') : red('✗')
    const body =
      t.name.padEnd(nameW) +
      '   ' +
      fmt(t.expected).padStart(10) +
      '   ' +
      fmt(t.actual).padStart(10)
    console.log('  ' + (t.match ? body : red(body)) + '  ' + mark)
  }
  console.log('  ' + dim(rule))
  const summary = `${okCount}/${tables.length} tables match · ${fmt(totalRows)} rows restored`
  console.log('  ' + (allOk ? green('✓ ' + summary) : red('✗ ' + summary)))

  for (const w of warns) console.log('  ' + yellow('! ') + w)
  if (p.missingOnDisk && p.missingOnDisk.length) {
    console.log('  ' + yellow(`Missing package files (${p.missingOnDisk.length}):`))
    for (const m of p.missingOnDisk.slice(0, 20)) console.log('    ' + dim(m))
  }
  if (orphans.length) {
    console.log(
      '  ' + yellow(`Agent packages referenced but not on disk (${orphans.length}):`),
    )
    for (const m of orphans.slice(0, 20)) console.log('    ' + dim(m))
  }
  console.log()
}

function printExport(o) {
  console.log(
    '  ' + green('✓') + ' ' + bold(o.filename) + '  ' + dim(`(${fmt(o.bytes)} bytes)`),
  )
}
