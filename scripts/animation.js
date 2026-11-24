// Animation frames may stop in background tabs. Timers bound every wait and
// release its scheduled frame so transitions cannot retain overlays forever.
export function waitForTransitionResource(promise, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Transition resource loading timed out.")), timeout);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export function animateProgress(duration, update, isActive = () => true) {
  return new Promise((resolve, reject) => {
    let frame;
    let timer;
    let settled = false;
    const finish = (completed, error) => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(completed);
    };
    const start = performance.now();
    const step = (timestamp, complete = false) => {
      if (settled) return;
      try {
        if (!isActive()) { finish(false); return; }
        const progress = complete || duration <= 0 ? 1 : Math.min(1, Math.max(0, (timestamp - start) / duration));
        update(progress);
        if (progress >= 1) finish(true);
        else frame = requestAnimationFrame(step);
      } catch (error) {
        finish(false, error);
      }
    };
    timer = setTimeout(() => step(performance.now(), true), Math.max(0, duration) + 100);
    frame = requestAnimationFrame(step);
  });
}

export function waitForRenderFrames(count = 2) {
  return new Promise((resolve) => {
    let frame;
    let remaining = Math.max(1, count);
    const finish = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resolve();
    };
    const step = () => {
      if (--remaining <= 0) finish();
      else frame = requestAnimationFrame(step);
    };
    const timer = setTimeout(finish, 100);
    frame = requestAnimationFrame(step);
  });
}
