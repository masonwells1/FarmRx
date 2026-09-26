#!/usr/bin/env node
// Prints the SQL an agent runs through the Supabase connector to apply a merged migration to the
// live database. See docs/database-migrations.md. This script only prints; it never connects.
//
//   node scripts/live-migration-sql.mjs status             which repo migrations the live history lacks
//   node scripts/live-migration-sql.mjs apply <version>    one migration, fingerprinted and recorded
//
// Why a wrapper instead of the connector's own apply_migration: that tool records the migration
// under the time it ran, not the file's version, so the live history and supabase/migrations/ would
// disagree forever and a later `supabase db push` would try to run the file again.
//
// The wrapper runs the file and writes its history row in ONE transaction, and refuses to run at all
// unless the text that reached the database has the same md5 as the committed file. A single
// character lost in transit therefore changes nothing.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')

// Postgres btrim(s, E' \n\r\t') and this must agree exactly, so String.prototype.trim (which also
// strips other Unicode whitespace) is deliberately not used.
export function edgeTrim(text) {
  return text.replace(/^[ \n\r\t]+/, '').replace(/[ \n\r\t]+$/, '')
}

export function fingerprint(text) {
  return createHash('md5').update(edgeTrim(text), 'utf8').digest('hex')
}

export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ version: name.slice(0, 14), name: name.slice(15, -4), file: join(migrationsDir, name) }))
}

function dollarTag(text) {
  for (let i = 0; ; i += 1) {
    const tag = `$fx${i}$`
    if (!text.includes(tag)) return tag
  }
}

export function statusSql(files) {
  const rows = files.map((f) => `('${f.version}', '${f.name}')`).join(',\n    ')
  return `select repo.version, repo.name,
       (h.version is not null) as recorded_live
  from (values
    ${rows}
  ) as repo(version, name)
  left join supabase_migrations.schema_migrations h on h.version = repo.version
 order by repo.version;`
}

export function applySql({ version, name, file }) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('$mig$')) throw new Error(`${version} contains $mig$; choose another outer tag`)
  const tag = dollarTag(text)
  return `do $mig$
declare
  s text := ${tag}
${edgeTrim(text)}
${tag};
  fp text := md5(btrim(s, E' \\n\\r\\t'));
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '${version}') then
    raise exception '${version} is already recorded live; nothing was run';
  end if;
  if fp <> '${fingerprint(text)}' then
    raise exception 'FINGERPRINT MISMATCH for ${version}: got %', fp;
  end if;
  execute s;
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('${version}', '${name}', array[s]);
end
$mig$;`
}

function main([command, version]) {
  const files = migrationFiles()
  if (command === 'status') return statusSql(files)
  if (command === 'apply') {
    const match = files.find((f) => f.version === version)
    if (!match) throw new Error(`no migration file has version ${version ?? '(none given)'}`)
    return applySql(match)
  }
  throw new Error('usage: live-migration-sql.mjs status | apply <14-digit version>')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${main(process.argv.slice(2))}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
