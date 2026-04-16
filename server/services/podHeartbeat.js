import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import PodMetrics from '../models/PodMetrics.js';
import { snapshot } from '../utils/requestCounters.js';
import logger from '../utils/logger.js';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let APP_VERSION = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  APP_VERSION = pkg.version || 'unknown';
} catch { /* ignore */ }

const POD_ID   = randomUUID();   // unique per process start
const STARTED  = new Date();
const INTERVAL = 30_000;        // 30 s

let prevCpuUsage = process.cpuUsage();
let prevCpuTime  = Date.now();
let timer        = null;

export function getPodId() { return POD_ID; }

async function beat() {
  try {
    const mem  = process.memoryUsage();
    const now  = Date.now();
    const cpu  = process.cpuUsage(prevCpuUsage);
    const dt   = now - prevCpuTime || 1;
    prevCpuUsage = process.cpuUsage();
    prevCpuTime  = now;

    // Approximate event loop lag via a small setTimeout drift
    const lagStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 0));
    const eventLoopLagMs = Date.now() - lagStart;

    const counters = snapshot();

    await PodMetrics.findOneAndUpdate(
      { podId: POD_ID },
      {
        podId:         POD_ID,
        role:          config.nodeRole,
        version:       APP_VERSION,
        hostname:      os.hostname(),
        pid:           process.pid,
        startedAt:     STARTED,
        updatedAt:     new Date(),
        heapUsedMb:    Math.round(mem.heapUsed  / 1024 / 1024 * 10) / 10,
        heapTotalMb:   Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
        rssMb:         Math.round(mem.rss       / 1024 / 1024 * 10) / 10,
        cpuUser:       Math.round(cpu.user   / 1000),   // μs → ms
        cpuSystem:     Math.round(cpu.system / 1000),
        cpuPct:        Math.round((cpu.user + cpu.system) / 1000 / dt * 100 * 10) / 10,
        eventLoopLagMs,
        reqPerMin:     counters.reqPerMin,
        blockedPerMin: counters.blockedPerMin,
        errorsPerMin:  counters.errorTotal,
        activeConnections: counters.activeConns,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    logger.debug('[pod-heartbeat] write failed', { error: err.message });
  }
}

export function startHeartbeat() {
  beat(); // immediate first beat
  timer = setInterval(beat, INTERVAL);
  timer.unref(); // don't keep process alive
  logger.info(`[pod-heartbeat] started (id=${POD_ID})`);
}

export function stopHeartbeat() {
  if (timer) clearInterval(timer);
}
