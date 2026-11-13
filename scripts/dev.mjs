// Хоёр серверийг (api, web) нэг командаар эхлүүлнэ. Ctrl+C дарахад хоёуланг нь зогсооно.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apps = [
  { name: 'api', cwd: path.join(root, 'api'), color: '\x1b[36m' },
  { name: 'web', cwd: path.join(root, 'web'), color: '\x1b[35m' },
]

for (const app of apps) {
  if (!existsSync(path.join(app.cwd, 'node_modules'))) {
    console.error(`${app.name}: node_modules алга. Эхлээд "npm run install:all" ажиллуулна уу.`)
    process.exit(1)
  }
}

const children = apps.map((app) => {
  const child = spawn('npm', ['run', 'dev'], { cwd: app.cwd, shell: process.platform === 'win32', env: process.env })
  const prefix = `${app.color}[${app.name}]\x1b[0m `
  const pipe = (stream) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) process.stdout.write(prefix + line + '\n')
    })
  pipe(child.stdout)
  pipe(child.stderr)
  child.on('exit', (code) => {
    console.log(`${prefix}зогсолоо (код ${code ?? 0})`)
    shutdown()
  })
  return child
})

function shutdown() {
  for (const child of children) if (!child.killed) child.kill('SIGINT')
  process.exitCode = 0
  setTimeout(() => process.exit(), 500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
console.log('API: http://localhost:4301   Web: http://localhost:3301')
