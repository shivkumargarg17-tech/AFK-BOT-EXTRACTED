'use strict';

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chance(value, fallback) {
  return Math.min(1, Math.max(0, number(value, fallback)));
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function delayMs(min, max) {
  const safeMin = Math.max(0.1, number(min, 1));
  const safeMax = Math.max(safeMin, number(max, safeMin));
  return Math.round(random(safeMin, safeMax) * 1000);
}

function createAntiAfkController(bot, antiAfk = {}, isHealthy = () => true) {
  const randomActions = antiAfk['random-actions'] || {};
  const timers = new Set();
  const counts = { move: 0, jump: 0, crouch: 0, punch: 0 };
  let stopped = false;

  const schedule = (fn, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) fn();
    }, delay);
    timers.add(timer);
  };

  const active = () => !stopped && isHealthy() && bot?.entity && bot?.player;

  const log = (name, detail = '') => {
    counts[name] += 1;
    if (antiAfk['log-actions'] === false) return;
    console.log(`[ACTION] ${name}${detail ? ` (${detail})` : ''} | total=${counts[name]}`);
  };

  const cfg = (name, defaults) => {
    const source = randomActions[name] || {};
    return {
      chance: chance(source.chance, defaults.chance),
      minDelay: number(source['min-delay'], defaults.minDelay),
      maxDelay: number(source['max-delay'], defaults.maxDelay),
      minDuration: number(source['min-duration'], defaults.minDuration || 0),
      maxDuration: number(source['max-duration'], defaults.maxDuration || 0)
    };
  };

  const movement = () => {
    const config = cfg('move', {
      chance: 1,
      minDelay: 2,
      maxDelay: 6,
      minDuration: 0.8,
      maxDuration: 2.5
    });
    schedule(() => {
      if (!active()) return;
      if (Math.random() > config.chance) return movement();
      const directions = ['forward', 'back', 'left', 'right'];
      const direction = directions[Math.floor(Math.random() * directions.length)];
      const duration = delayMs(config.minDuration, config.maxDuration);
      bot.look(random(-Math.PI, Math.PI), random(-0.2, 0.2), true).catch(() => {});
      bot.setControlState(direction, true);
      bot.setControlState('sprint', direction === 'forward');
      log('move', `${direction}, ${(duration / 1000).toFixed(1)}s`);
      schedule(() => {
        if (!active()) return;
        bot.setControlState(direction, false);
        bot.setControlState('sprint', false);
        movement();
      }, duration);
    }, delayMs(config.minDelay, config.maxDelay));
  };

  const repeatingAction = (name, control, defaults) => {
    const run = () => {
      const config = cfg(name, defaults);
      schedule(() => {
        if (!active()) return;
        if (Math.random() <= config.chance) {
          const duration = delayMs(config.minDuration, config.maxDuration);
          bot.setControlState(control, true);
          log(name, name === 'crouch' ? `${(duration / 1000).toFixed(1)}s` : '');
          schedule(() => {
            if (active()) bot.setControlState(control, false);
          }, duration);
        }
        run();
      }, delayMs(config.minDelay, config.maxDelay));
    };
    run();
  };

  const punch = () => {
    const config = cfg('punch', { chance: 0.75, minDelay: 2, maxDelay: 10 });
    schedule(() => {
      if (!active()) return;
      if (Math.random() <= config.chance) {
        bot.swingArm('right');
        log('punch');
      }
      punch();
    }, delayMs(config.minDelay, config.maxDelay));
  };

  const summary = () => {
    const seconds = Math.max(15, number(antiAfk['summary-interval'], 60));
    schedule(() => {
      if (!active()) return;
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      const details = Object.entries(counts)
        .map(([name, value]) => `${name}=${value} (${total ? ((value / total) * 100).toFixed(1) : '0.0'}%)`)
        .join(', ');
      console.log(`[ACTION SUMMARY] total=${total} | ${details}`);
      summary();
    }, seconds * 1000);
  };

  const start = () => {
    if (!antiAfk.enabled || randomActions.enabled === false) return;
    movement();
    repeatingAction('jump', 'jump', {
      chance: 0.7,
      minDelay: 2,
      maxDelay: 8,
      minDuration: 0.15,
      maxDuration: 0.45
    });
    repeatingAction('crouch', 'sneak', {
      chance: 0.5,
      minDelay: 4,
      maxDelay: 12,
      minDuration: 0.5,
      maxDuration: 2.5
    });
    punch();
    summary();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    try {
      bot.clearControlStates();
    } catch {
      // The socket may already be gone.
    }
  };

  return { start, stop, counts };
}

module.exports = { createAntiAfkController };
