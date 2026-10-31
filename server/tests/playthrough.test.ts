import assert from 'node:assert/strict';
import test from 'node:test';
import { MAPS } from '../../shared/heist';
import { playFinale, playSetup } from '../../tools/heist-playthrough';
import { HEISTS } from '../../shared/heist-campaign';
import { playGetaway } from '../../tools/getaway-playthrough';

// These bots use only real inputs, with guards, cameras and lasers on. If they can finish, a player can.
test('every finale can be won start to finish on Relaxed', () => {
  for (let level = 0; level < MAPS.length; level++) {
    const r = playFinale(level, 'relaxed', 'infiltrator');
    assert.equal(r.phase, 'won', `${MAPS[level].name}: ${r.notice}`);
  }
});

test('the museum and the bank can be won on Standard', () => {
  for (const level of [0, 1]) {
    const r = playFinale(level, 'standard', 'hacker');
    assert.equal(r.phase, 'won', `${MAPS[level].name}: ${r.notice}`);
  }
});

test('the getaway can be won from the loading dock: lose the cops, reach the house', () => {
  for (const [stars, driver] of [[1, 'teo'], [3, 'kip']] as const) {
    const r = playGetaway(stars, driver);
    assert.equal(r.phase, 'won', `${driver} at ${stars} stars ended ${r.phase} after ${r.seconds}s`);
  }
});

test('every setup can be won on Relaxed, and every required setup on Standard', () => {
  for (const heist of HEISTS) for (const setup of heist.setups) {
    assert.equal(playSetup(heist.level, setup.id, 'relaxed').phase, 'won', `${setup.name} on Relaxed`);
    if (setup.id !== heist.casing) assert.equal(playSetup(heist.level, setup.id, 'standard').phase, 'won', `${setup.name} on Standard`);
  }
});
