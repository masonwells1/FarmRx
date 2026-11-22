import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { GRADE_RX_SOURCE_TOKEN, ...buildEnv } = process.env
delete process.env.GRADE_RX_SOURCE_TOKEN
const { loadEnv } = await import('vite')
const gradeSourceCommit = '25c4f8d7623db6034f197a63480e9e4f19124aa7'
const { VITE_GRADE_RX_PILOT_USER_ID: pilot } = loadEnv('production', process.cwd(), 'VITE_GRADE_RX_PILOT_USER_ID')
if (pilot && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pilot)) {
  throw new Error('Grade Rx pilot account must be a Farm Rx user ID.')
}

function runFarmBuild(entry, ...args) {
  execFileSync(process.execPath, [fileURLToPath(new URL(entry, import.meta.url)), ...args], { env: buildEnv, stdio: 'inherit' })
}

runFarmBuild('../node_modules/typescript/bin/tsc', '-b')
runFarmBuild('../node_modules/vite/bin/vite.js', 'build')
if (!pilot) process.exit(0)

function copyWorkspace(source) {
  const html = readFileSync(join(source, 'index.html'), 'utf8')
  if (!html.includes('<title>GradeRx · Crop RX Solutions</title>') || !html.includes('src="/grade-rx-app/assets/')) {
    throw new Error('Expected a Grade Rx build made with --mode farm-rx.')
  }
  const resources = [...html.matchAll(/\b(?:href|src)="\/grade-rx-app\/((?:assets\/)?[\w.-]+)"/g)].map((match) => match[1])
  if (!resources.some((resource) => resource.startsWith('assets/') && resource.endsWith('.js'))) {
    throw new Error('Grade Rx build has no workspace script.')
  }
  for (const resource of [...resources, 'atlas14-il.json', 'atlas14-il.bin']) {
    const file = statSync(join(source, resource), { throwIfNoEntry: false })
    if (!file?.isFile() || !file.size) throw new Error(`Grade Rx build is missing ${resource}.`)
  }
  cpSync(source, 'dist/grade-rx-app', { recursive: true })
}

const localBuild = buildEnv.GRADE_RX_LOCAL_BUILD
if (localBuild) {
  if (buildEnv.VERCEL) throw new Error('Hosted Grade Rx builds require the private source pin.')
  copyWorkspace(resolve(localBuild))
} else {
  if (!GRADE_RX_SOURCE_TOKEN) throw new Error('Grade Rx pilot needs its private source read credential.')
  const base = resolve(tmpdir())
  const staging = mkdtempSync(join(base, 'farm-grade-rx-'))
  try {
    const info = await fetch(`https://api.github.com/repos/croprxsolutions/GradeRx/tarball/${gradeSourceCommit}`, {
      headers: { Authorization: `Bearer ${GRADE_RX_SOURCE_TOKEN}`, Accept: 'application/vnd.github+json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    const archiveUrl = new URL(info.headers.get('location') ?? 'https://invalid.example')
    if (info.status !== 302 || archiveUrl.origin !== 'https://codeload.github.com') {
      throw new Error(`GitHub refused the pinned Grade Rx source archive (${info.status}).`)
    }
    const archive = await fetch(archiveUrl, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!archive.ok) throw new Error(`Unable to download the Grade Rx source archive (${archive.status}).`)
    const source = join(staging, 'source')
    const archivePath = join(staging, 'source.tar.gz')
    mkdirSync(source)
    writeFileSync(archivePath, new Uint8Array(await archive.arrayBuffer()))
    const systemKeys = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TMP', 'TEMP', 'TMPDIR'])
    const childEnv = Object.fromEntries(Object.entries(buildEnv).filter(([key]) => systemKeys.has(key.toUpperCase())))
    childEnv.HOME = staging
    childEnv.USERPROFILE = staging
    childEnv.npm_config_userconfig = join(staging, 'npmrc')
    writeFileSync(childEnv.npm_config_userconfig, '')
    const childOptions = { cwd: source, env: childEnv, stdio: 'inherit' }
    execFileSync('tar', ['-xzf', archivePath, '-C', source, '--strip-components=1'], childOptions)
    const npm = buildEnv.npm_execpath
    if (!npm) throw new Error('Run the Grade Rx build through npm run build.')
    execFileSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], childOptions)
    execFileSync(process.execPath, [npm, 'run', 'build', '--', '--mode', 'farm-rx'], childOptions)
    copyWorkspace(join(source, 'dist'))
  } finally {
    if (dirname(staging) === base && basename(staging).startsWith('farm-grade-rx-')) rmSync(staging, { force: true, recursive: true })
  }
}
