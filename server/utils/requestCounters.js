/**
 * Lightweight in-memory request counters.
 * Each pod tracks its own counters; the System Dashboard aggregates across pods.
 */

let reqTotal     = 0;
let blockedTotal = 0;
let errorTotal   = 0;
let activeConns  = 0;

// Per-minute ring buffer — one slot per second, 60 slots
const RING_SIZE  = 60;
const reqRing    = new Array(RING_SIZE).fill(0);
const blockedRing = new Array(RING_SIZE).fill(0);
let ringTick     = 0;
let lastTickSec  = Math.floor(Date.now() / 1000);

function advanceRing() {
  const nowSec = Math.floor(Date.now() / 1000);
  const delta  = nowSec - lastTickSec;
  if (delta <= 0) return;
  const steps = Math.min(delta, RING_SIZE);
  for (let i = 0; i < steps; i++) {
    ringTick        = (ringTick + 1) % RING_SIZE;
    reqRing[ringTick]     = 0;
    blockedRing[ringTick] = 0;
  }
  lastTickSec = nowSec;
}

export function incReq()     { advanceRing(); reqTotal++;     reqRing[ringTick]++; }
export function incBlocked() { advanceRing(); blockedTotal++; blockedRing[ringTick]++; }
export function incError()   { advanceRing(); errorTotal++; }
export function incActive()  { activeConns++; }
export function decActive()  { if (activeConns > 0) activeConns--; }

/** Requests in the last 60 seconds */
export function reqPerMin()     { advanceRing(); return reqRing.reduce((s, v) => s + v, 0); }
/** Blocked in the last 60 seconds */
export function blockedPerMin() { advanceRing(); return blockedRing.reduce((s, v) => s + v, 0); }

export function snapshot() {
  advanceRing();
  return {
    reqTotal,
    blockedTotal,
    errorTotal,
    activeConns,
    reqPerMin:     reqRing.reduce((s, v) => s + v, 0),
    blockedPerMin: blockedRing.reduce((s, v) => s + v, 0),
  };
}
