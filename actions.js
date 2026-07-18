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
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) fn();
    }, Math.max(50, delay));
    timer.unref?.();
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

  const retryWhenUnhealthy = fn => schedule(fn, 1000);

  const movement = () => {
    const config = cfg('move', {
      chance: 1,
      minDelay: 3,
      maxDelay: 7,
      minDuration: 0.35,
      maxDuration: 0.8
    });

    schedule(() => {
      if (!active()) return retryWhenUnhealthy(movement);
      if (Math.random() > config.chance) return movement();

      const pairs = [
        ['forward', 'back'],
        ['back', 'forward'],
        ['left', 'right'],
        ['right', 'left']
      ];
      const [first, opposite] = pairs[Math.floor(Math.random() * pairs.length)];
      const duration = delayMs(config.minDuration, config.maxDuration);

      bot.look(random(-Math.PI, Math.PI), random(-0.15, 0.15), true).catch(() => {});
      bot.setControlState(first, true);
      log('move', `${first}+${opposite}, ${(duration / 1000).toFixed(1)}s each`);

      schedule(() => {
        bot.setControlState(first, false);
        if (!active()) return retryWhenUnhealthy(movement);

        bot.setControlState(opposite, true);
        schedule(() => {
          bot.setControlState(opposite, false);
          if (active()) movement();
          else retryWhenUnhealthy(movement);
        }, duration);
      }, duration);
    }, delayMs(config.minDelay, config.maxDelay));
  };

  const repeatingAction = (name, control, defaults) => {
    const run = () => {
      const config = cfg(name, defaults);
      schedule(() => {
        if (!active()) return retryWhenUnhealthy(run);

        if (Math.random() <= config.chance) {
          const duration = delayMs(config.minDuration, config.maxDuration);
          bot.setControlState(control, true);
          log(name, name === 'crouch' ? `${(duration / 1000).toFixed(1)}s` : '');
          schedule(() => {
            try { bot.setControlState(control, false); } catch {}
          }, duration);
        }

        run();
      }, delayMs(config.minDelay, config.maxDelay));
    };
    run();
  };

  const punch = () => {
    const config = cfg('punch', { chance: 0.65, minDelay: 7, maxDelay: 16 });
    schedule(() => {
      if (!active()) return retryWhenUnhealthy(punch);
      if (Math.random() <= config.chance) {
        bot.swingArm('right');
        log('punch');
      }
      punch();
    }, delayMs(config.minDelay, config.maxDelay));
  };

  const summary = () => {
    const seconds = Math.max(30, number(antiAfk['summary-interval'], 300));
    schedule(() => {
      if (!active()) return retryWhenUnhealthy(summary);
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
      chance: 0.75,
      minDelay: 5,
      maxDelay: 12,
      minDuration: 0.15,
      maxDuration: 0.35
    });
    repeatingAction('crouch', 'sneak', {
      chance: 0.5,
      minDelay: 10,
      maxDelay: 20,
      minDuration: 0.5,
      maxDuration: 1.5
    });
    punch();
    summary();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    try { bot.clearControlStates(); } catch {}
  };

  return { start, stop, counts };
}

module.exports = { createAntiAfkController };
