import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { preloadOpenIcons } from './data';
import type { Board } from './grades';
import { reportOptimizationFailure, type OptimizationSettings } from './optimizationFeedback';
import { OptimizationJob } from './optimizationJob';
import type { OptimizationProgress } from './optimizationProtocol';
import type { OptimizationResult } from './optimizer';

export type CalculationResult = Omit<OptimizationResult, 'commonCounts'> & { commonCounts: Map<string, number> };

interface Props {
  settings: OptimizationSettings;
  boards: Board[];
  onStart: () => void;
  onResult: (result: CalculationResult | null) => void;
}

export function CalculationControls({ settings, boards, onStart, onResult }: Props) {
  const [job] = useState(() => new OptimizationJob());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progress, setProgress] = useState<OptimizationProgress | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const calculateButton = useRef<HTMLButtonElement>(null);
  const calculating = startedAt !== null;
  const estimatedSeconds = progress?.durationSeconds;

  useLayoutEffect(() => {
    setStartedAt(null);
    onResult(null);
    return () => job.cancel();
  }, [job, settings, boards, onResult]);

  useLayoutEffect(() => {
    const modal = dialog.current!;
    if (calculating) {
      if (!modal.open) modal.showModal();
      return;
    }
    if (modal.open) {
      modal.close();
      calculateButton.current?.focus();
    }
  }, [calculating]);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  function calculate() {
    setStartedAt(performance.now());
    setElapsedSeconds(0);
    setProgress(null);
    onStart();
    onResult(null);
    preloadOpenIcons();
    job.start(settings, () => new Worker(new URL('./optimization.worker.ts', import.meta.url), { type: 'module' }),
      response => {
        setStartedAt(null);
        if (response.failure) {
          dialog.current?.close();
          reportOptimizationFailure(response.failure);
          calculateButton.current?.focus();
          return;
        }
        const { commonCounts, ...result } = response.result;
        const countsByName = new Map(settings.commonNodePriority.map((name, index) => [name, commonCounts[index]]));
        onResult({ ...result, commonCounts: countsByName });
      }, boards, setProgress);
  }

  function cancel() {
    job.cancel();
    setStartedAt(null);
  }

  return <>
    <button className="calculate" type="button" ref={calculateButton} onClick={calculate}>최적화 계산<span>→</span></button>
    {createPortal(<dialog ref={dialog} className="calculation-dialog" aria-labelledby="calculation-title" onCancel={event => event.preventDefault()}>
      <p id="calculation-title">최적화 계산 중</p>
      <div className="calculation-progress">
        <p role="status">
          <span aria-hidden={!progress?.memoryRetry}>메모리 초과로 계산 방식 변경</span>
        </p>
        <dl className="calculation-times">
          <dt>예상 시간</dt>
          <dd aria-live="polite">{estimatedSeconds == null ? '계산 중' : `약 ${Math.max(estimatedSeconds, elapsedSeconds)}초`}</dd>
          <dt>경과 시간</dt>
          <dd>{elapsedSeconds}초</dd>
        </dl>
      </div>
      <button type="button" autoFocus onClick={cancel}>중단</button>
    </dialog>, document.body)}
  </>;
}
