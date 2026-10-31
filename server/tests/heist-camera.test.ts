import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraFollow } from '../../client/heist/camera-follow';

test('a held sideways move keeps its world direction while the camera follows', () => {
  const camera = new CameraFollow();
  const heading = Math.PI / 2;

  for (let frame = 0; frame < 90; frame += 1) {
    const move = camera.movement(1, 0);
    assert.ok(Math.abs(move.x - 1) < 1e-12);
    assert.ok(Math.abs(move.z) < 1e-12);
    camera.follow(heading, 3.2, 1 / 30, frame * (1000 / 30));
  }

  assert.ok(Math.abs(camera.yaw + Math.PI / 2) < 1e-3);
  camera.resetMovement();
  const forward = camera.movement(0, 1);
  assert.ok(Math.abs(forward.x + Math.sin(camera.yaw)) < 1e-12);
  assert.ok(Math.abs(forward.z + Math.cos(camera.yaw)) < 1e-12);
});
