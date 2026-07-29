export function seasonLoopbackPort(name: string, fallback: number): number {
  const raw = process.env[name] ?? String(fallback)
  if (!/^[1-9][0-9]{3,4}$/.test(raw)) throw new Error(`${name} must be a canonical loopback TCP port.`)
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || String(port) !== raw) throw new Error(`${name} must be a canonical loopback TCP port.`)
  return port
}

export function seasonLoopbackOrigin(name: string, fallback: number): string {
  return `http://127.0.0.1:${seasonLoopbackPort(name, fallback)}`
}
