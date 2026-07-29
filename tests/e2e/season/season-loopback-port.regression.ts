import assert from 'node:assert/strict'
import { seasonLoopbackOrigin, seasonLoopbackPort } from './season-loopback-port'

const original = process.env.FARMRX_SEASON_PORT_REGRESSION
try {
  delete process.env.FARMRX_SEASON_PORT_REGRESSION
  assert.equal(seasonLoopbackPort('FARMRX_SEASON_PORT_REGRESSION', 4274), 4274)
  assert.equal(seasonLoopbackOrigin('FARMRX_SEASON_PORT_REGRESSION', 4274), 'http://127.0.0.1:4274')
  for (const value of ['0', '08080', '80', '65536', 'http://127.0.0.1:4274', '4274.0']) {
    process.env.FARMRX_SEASON_PORT_REGRESSION = value
    assert.throws(() => seasonLoopbackPort('FARMRX_SEASON_PORT_REGRESSION', 4274), /canonical loopback TCP port/)
  }
} finally {
  if (original === undefined) delete process.env.FARMRX_SEASON_PORT_REGRESSION
  else process.env.FARMRX_SEASON_PORT_REGRESSION = original
}

console.log('SEASON_LOOPBACK_PORT_REGRESSION_PASS')
