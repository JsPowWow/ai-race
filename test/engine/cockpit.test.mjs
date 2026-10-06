// Вид из машины: камера позади машины и проекция точек трассы на экран.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewOf, project, clipNear, Chase, CHASE } from '../../engine/draw/cockpit/camera.ts';

const screen = { width: 1000, height: 600 };
const along = (angle) => viewOf({ x: 0, y: 0, angle }, screen); // камера в начале координат

test('точка прямо впереди — посередине экрана, ниже горизонта; дальше — ближе к горизонту', () => {
  const v = along(0);
  const near = project(v, 100, 0, 0), far = project(v, 600, 0, 0);
  assert.ok(near && far);
  assert.equal(Math.round(near.x), 500);
  assert.ok(near.y > v.horizon && far.y > v.horizon, 'земля — под горизонтом');
  assert.ok(far.y < near.y, 'дальнее выше на экране');
});

test('правее по ходу — правее на экране, выше над землёй — выше на экране', () => {
  const v = along(Math.PI / 2); // едем «вниз» по трассе (y растёт): справа по ходу — меньший x
  const right = project(v, -40, 200, 0), left = project(v, 40, 200, 0);
  assert.ok(right && left);
  assert.ok(right.x > 500 && left.x < 500);
  const ground = project(v, 0, 200, 0), top = project(v, 0, 200, 30);
  assert.ok(ground && top && top.y < ground.y);
});

test('позади камеры ничего не рисуется, а многоугольник обрезается по ближней плоскости', () => {
  const v = along(0);
  assert.equal(project(v, -50, 0, 0), null);
  // квадрат, который начинается позади камеры и уходит вперёд
  const cut = clipNear(v, [{ x: -50, y: -20, z: 0 }, { x: 50, y: -20, z: 0 }, { x: 50, y: 20, z: 0 }, { x: -50, y: 20, z: 0 }]);
  assert.equal(cut.length, 4);
  for (const p of cut) assert.ok(p.f >= v.near - 1e-9);
  assert.deepEqual(clipNear(v, [{ x: -50, y: 0, z: 0 }, { x: -60, y: 5, z: 0 }, { x: -55, y: -5, z: 0 }]), []);
});

test('камера едет позади машины и догоняет её поворот плавно', () => {
  const chase = new Chase();
  chase.follow({ x: 100, y: 0, angle: 0 });
  assert.equal(Math.round(chase.x), 100 - CHASE.back);
  chase.follow({ x: 100, y: 0, angle: 0.4 }); // машина резко повернула
  assert.ok(chase.angle > 0 && chase.angle < 0.4, 'камера поворачивает следом, но не рывком');
  for (let i = 0; i < 200; i++) chase.follow({ x: 100, y: 0, angle: 0.4 });
  assert.ok(Math.abs(chase.angle - 0.4) < 1e-3);
  chase.follow({ x: 0, y: 0, angle: Math.PI }); // машину поставили на старт — камера прыгает сразу
  assert.equal(chase.angle, Math.PI);
});

test('на разгоне камера отстаёт на пружине, но машина не убегает из кадра', () => {
  const chase = new Chase();
  for (let x = 0; x < 2000; x += 6) chase.follow({ x, y: 0, angle: 0 }); // едем быстро по прямой
  const gap = 1994 - chase.x;
  assert.ok(gap > CHASE.back && gap <= CHASE.back * 1.12 + 1e-9, `камера в ${gap.toFixed(1)} px позади`);
  assert.ok(Math.abs(chase.angle) < 1e-9, 'на прямой смотрит ровно вперёд');
});
