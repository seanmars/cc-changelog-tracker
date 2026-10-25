import { setTimeout as sleep } from 'node:timers/promises';
import { errorMessage, type Logger } from './logs.ts';
import type { ParseResult, TrackerConfig } from './settings.ts';

export interface SchedulerDeps {
  loadConfig(): ParseResult;
  check(config: TrackerConfig): Promise<void>;
  log: Logger;
}

export interface Scheduler {
  run(signal: AbortSignal): Promise<void>;
  wake(): void;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let wakeController = new AbortController();

  return {
    wake: () => wakeController.abort(),
    run: async (signal) => {
      let currentInterval: number | null = null;
      // 每次檢查完成後才開始計時, 所以不會有兩次檢查同時執行.
      while (!signal.aborted) {
        // 在檢查之前建立. 檢查途中改了設定, 檢查結束後會立刻用新設定再跑一次.
        wakeController = new AbortController();
        const waitSignal = AbortSignal.any([signal, wakeController.signal]);
        const result = deps.loadConfig();

        if (!result.ok) {
          // 設定未完成時不啟動計時器, 一直等到後台存檔.
          currentInterval = null;
          deps.log('info', `設定未完成, 暫停 tracking: ${result.problems.join(', ')}`);
          await waitFor(null, waitSignal);
          continue;
        }

        const { config } = result;
        if (config.checkIntervalMinutes !== currentInterval) {
          currentInterval = config.checkIntervalMinutes;
          deps.log('info', `開始 tracking, 每 ${currentInterval} 分鐘檢查一次`);
        }
        try {
          await deps.check(config);
        } catch (error) {
          deps.log('error', `檢查失敗, 下次重試: ${errorMessage(error)}`);
        }
        await waitFor(currentInterval * 60_000, waitSignal);
      }
    },
  };
}

// ms 為 null 時沒有時間限制, 只等 signal.
function waitFor(ms: number | null, signal: AbortSignal): Promise<void> {
  if (ms !== null) return sleep(ms, undefined, { signal }).catch(() => {});
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
