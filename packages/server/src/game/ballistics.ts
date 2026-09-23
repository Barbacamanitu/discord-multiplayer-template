// Shot physics for ScorchMatch. The server is the only place this runs: it simulates each shot once
// and sends the sampled path to clients to animate, so clients never need their own copy.

export interface StageInfo {
  width: number;
  groundY: number;
  tankWidth: number;
  tankHeight: number;
  barrelLength: number;
}

export interface TankInfo {
  // x is the tank's center, y is the bottom of the tank (where it sits on the ground)
  x: number;
  y: number;
  health: number;
}

export interface ShotResult {
  // flattened [x0, y0, x1, y1, ...] positions, one every stepMs
  points: number[];
  stepMs: number;
  // where the shell exploded, or null if it left the stage
  impact: { x: number; y: number } | null;
}

export const GRAVITY = 400; // px/s^2
export const POWER_TO_VELOCITY = 8; // power 100 -> 800 px/s
export const EXPLOSION_RADIUS = 50;
export const MAX_DAMAGE = 60;

const SIM_DT = 1 / 60;
const SAMPLE_EVERY = 2; // keep every 2nd step, so points are ~33ms apart
const MAX_FLIGHT_SECONDS = 15;
// ignore the shooter's own tank for the first moments so steep shots don't hit it on the way out
const SELF_HIT_GRACE_SECONDS = 0.15;

export function barrelTip(stage: StageInfo, tank: TankInfo, angle: number) {
  const rad = (angle * Math.PI) / 180;
  const pivotY = tank.y - stage.tankHeight;
  return { x: tank.x + Math.cos(rad) * stage.barrelLength, y: pivotY - Math.sin(rad) * stage.barrelLength };
}

function insideTank(stage: StageInfo, tank: TankInfo, x: number, y: number) {
  return (
    tank.health > 0 &&
    x >= tank.x - stage.tankWidth / 2 &&
    x <= tank.x + stage.tankWidth / 2 &&
    y >= tank.y - stage.tankHeight &&
    y <= tank.y
  );
}

// angle is in degrees: 0 points right, 90 straight up, 180 left. power is 0-100.
export function simulateShot(stage: StageInfo, tanks: TankInfo[], shooter: number, angle: number, power: number): ShotResult {
  const rad = (angle * Math.PI) / 180;
  const speed = power * POWER_TO_VELOCITY;
  let { x, y } = barrelTip(stage, tanks[shooter], angle);
  let vx = Math.cos(rad) * speed;
  let vy = -Math.sin(rad) * speed;

  const points = [Math.round(x), Math.round(y)];
  const maxSteps = MAX_FLIGHT_SECONDS / SIM_DT;
  for (let step = 1; step <= maxSteps; step++) {
    vy += GRAVITY * SIM_DT;
    x += vx * SIM_DT;
    y += vy * SIM_DT;

    const t = step * SIM_DT;
    const hitTank = tanks.some((tank, i) => (i !== shooter || t > SELF_HIT_GRACE_SECONDS) && insideTank(stage, tank, x, y));
    const hitGround = y >= stage.groundY;
    if (hitTank || hitGround) {
      const impact = { x: Math.round(x), y: Math.round(Math.min(y, stage.groundY)) };
      points.push(impact.x, impact.y);
      return { points, stepMs: SIM_DT * SAMPLE_EVERY * 1000, impact };
    }
    // no walls or ceiling: anything past the sides is a miss (it can still come back down from above)
    if (x < 0 || x > stage.width) {
      points.push(Math.round(x), Math.round(y));
      return { points, stepMs: SIM_DT * SAMPLE_EVERY * 1000, impact: null };
    }
    if (step % SAMPLE_EVERY === 0) {
      points.push(Math.round(x), Math.round(y));
    }
  }
  return { points, stepMs: SIM_DT * SAMPLE_EVERY * 1000, impact: null };
}

// Damage per tank from an explosion: MAX_DAMAGE at the center, falling off linearly to 0 at EXPLOSION_RADIUS.
// Distance is measured to the nearest point of the tank's body, so a direct hit does full damage.
export function explosionDamage(stage: StageInfo, tanks: TankInfo[], impact: { x: number; y: number }): number[] {
  return tanks.map((tank) => {
    if (tank.health <= 0) {
      return 0;
    }
    const nearestX = Math.max(tank.x - stage.tankWidth / 2, Math.min(impact.x, tank.x + stage.tankWidth / 2));
    const nearestY = Math.max(tank.y - stage.tankHeight, Math.min(impact.y, tank.y));
    const distance = Math.hypot(impact.x - nearestX, impact.y - nearestY);
    return distance >= EXPLOSION_RADIUS ? 0 : Math.round(MAX_DAMAGE * (1 - distance / EXPLOSION_RADIUS));
  });
}

// Simple AI: pick a firing angle toward the target, search for the power that lands closest, then add some error
// so it doesn't hit every time.
export function chooseAiShot(stage: StageInfo, tanks: TankInfo[], shooter: number, target: number) {
  const facingRight = tanks[target].x > tanks[shooter].x;
  const baseAngle = 45 + Math.random() * 20;
  const angle = Math.round(facingRight ? baseAngle : 180 - baseAngle);

  let bestPower = 50;
  let bestMiss = Infinity;
  for (let power = 10; power <= 100; power++) {
    const { impact } = simulateShot(stage, tanks, shooter, angle, power);
    const miss = impact ? Math.abs(impact.x - tanks[target].x) : Infinity;
    if (miss < bestMiss) {
      bestMiss = miss;
      bestPower = power;
    }
  }

  const jitter = (range: number) => Math.round((Math.random() * 2 - 1) * range);
  return {
    angle: clamp(angle + jitter(3), 0, 180),
    power: clamp(bestPower + jitter(4), 0, 100),
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
