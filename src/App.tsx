import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { classes, costs, getBoards, iconFor, type Board, type BoardNode, type Grade } from './data';
import { CalculationControls, type CalculationResult } from './CalculationControls';
import { nodeKey } from './optimizationGraph';
import { createInitialSettings, defaultPriority, defaultRequiredNodes, getRequiredNodeOptions, requiredNodeSettings, skillLevels, type RequiredNodeOption, type RequiredNodes, type SkillLevel } from './settingsDefaults';
import { summarizeEffects } from './optimizationEffects';
import { specialGrades, type SpecialGrade } from './grades';

type Drag = { name: string; x: number; y: number; width: number; offsetX: number; offsetY: number };
type TooltipContent = { node: BoardNode; boardNames?: string[]; boardName?: string };
type Tooltip = TooltipContent & { anchor: DOMRect; trigger: HTMLElement; pointer?: { x: number; y: number } };
type TooltipTouch = { id: number; x: number; y: number; trigger: HTMLElement };
const nodeLabel = (name: string) => name.replace(/^스킬 레벨 상승 - (?:소환: )?/, '');
const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function countCommonNodes(nodes: BoardNode[]) {
  const counts = new Map<string, number>();
  for (const { name, grade } of nodes) {
    if (grade === '일반') counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function NodeTooltip({ node, anchor, pointer, boardNames, boardName, mobile }: Tooltip & { mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    const x = pointer?.x ?? anchor.right;
    const y = pointer?.y ?? anchor.top;
    const left = Math.max(8, Math.min(x + 14 + rect.width > window.innerWidth - 8 ? x - rect.width - 14 : x + 14, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y + 18 + rect.height > window.innerHeight - 8 ? y - rect.height - 14 : y + 18, window.innerHeight - rect.height - 8));
    setPosition({ left, top, ready: true });
  }, [anchor, pointer, node, boardNames]);
  return createPortal(<div ref={ref} id="node-tooltip" role="tooltip" className={`node-tooltip ${node.grade}${mobile ? ' mobile' : ''}`} style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>
    {!boardNames && <strong>{node.type === 'Start' ? `${boardName} - 시작` : nodeLabel(node.name)}</strong>}{(boardNames || node.type !== 'Start') && <div className={`tooltip-description ${boardNames ? 'boards-only' : ''}`}>{boardNames ? <p>{boardNames.join(' · ')}</p> : node.effectList.filter(e => e.desc).map((effect, i) => <p key={i}>{effect.desc}</p>)}</div>}
  </div>, document.body);
}
function useNodeTooltip() {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const touchStart = useRef<TooltipTouch | null>(null);
  const closeTooltip = useCallback(() => {
    touchStart.current = null;
    setTooltip(null);
  }, []);

  useEffect(() => {
    function dismissOutsideTap(event: globalThis.PointerEvent) {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      touchStart.current = null;
      const target = event.target;
      if (target instanceof Node) setTooltip(current => current?.trigger.contains(target) ? current : null);
    }
    function cancelTouch(event: globalThis.PointerEvent) {
      if (event.pointerId === touchStart.current?.id) closeTooltip();
    }
    function dismissSwipe(event: globalThis.PointerEvent) {
      const start = touchStart.current;
      if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) cancelTouch(event);
    }
    document.addEventListener('pointerdown', dismissOutsideTap, true);
    document.addEventListener('pointermove', dismissSwipe, true);
    document.addEventListener('pointercancel', cancelTouch, true);
    // Close on wheel input and catch scroll events from the page or any nested container.
    document.addEventListener('wheel', closeTooltip, { capture: true, passive: true });
    document.addEventListener('scroll', closeTooltip, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutsideTap, true);
      document.removeEventListener('pointermove', dismissSwipe, true);
      document.removeEventListener('pointercancel', cancelTouch, true);
      document.removeEventListener('wheel', closeTooltip, true);
      document.removeEventListener('scroll', closeTooltip, true);
    };
  }, [closeTooltip]);

  const tooltipEvents = useCallback((content: TooltipContent) => ({
    onPointerEnter(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== 'mouse') return;
      const trigger = event.currentTarget;
      const pointer = { x: event.clientX, y: event.clientY };
      setTooltip({ ...content, trigger, anchor: trigger.getBoundingClientRect(), pointer });
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== 'mouse') return;
      const trigger = event.currentTarget;
      const pointer = { x: event.clientX, y: event.clientY };
      setTooltip(current => current?.trigger === trigger && current.pointer ? { ...current, pointer } : current);
    },
    onPointerLeave(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== 'mouse') return;
      const trigger = event.currentTarget;
      setTooltip(current => current?.trigger === trigger && current.pointer ? null : current);
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      touchStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY, trigger: event.currentTarget };
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const start = touchStart.current;
      const trigger = event.currentTarget;
      if (start?.id !== event.pointerId || start.trigger !== trigger) return;
      touchStart.current = null;
      setTooltip({ ...content, trigger, anchor: trigger.getBoundingClientRect() });
    },
  }), []);

  return { tooltip, tooltipEvents, closeTooltip };
}

type TooltipEvents = ReturnType<typeof useNodeTooltip>['tooltipEvents'];

const BoardGrid = memo(function BoardGrid({ board, classKey, activeKeys, tooltipNodeId, tooltipEvents }: {
  board: Board; classKey: string; activeKeys: Set<string>; tooltipNodeId?: number; tooltipEvents: TooltipEvents;
}) {
  return <div className="board-viewport">
    <div className="board-grid">{board.nodeList.filter(node => node.type !== 'None').map(node => {
      const active = activeKeys.has(nodeKey(board.boardKey, node.nodeId));
      return (
      <button
        key={node.nodeId}
        type="button"
        tabIndex={-1}
        className={`board-node ${node.type === 'Start' ? 'start-node' : ''}`}
        style={{ gridRow: node.row, gridColumn: node.col }}
        aria-label={`${node.name}, ${node.type === 'Start' ? '시작 노드' : node.grade}`}
        aria-describedby={tooltipNodeId === node.nodeId ? 'node-tooltip' : undefined}
        {...tooltipEvents({ node, boardName: board.boardName })}
      >
        <img className={!active && node.type !== 'Start' ? 'inactive-node-icon' : undefined} src={iconFor(node, classKey, active)} alt="" draggable={false} />
      </button>
      );
    })}</div>
  </div>;
});

const RequiredNodeOptions = memo(function RequiredNodeOptions({ options, grade, required, mobile, tooltipName, tooltipEvents, setRequired }: {
  options: readonly RequiredNodeOption[]; grade: SpecialGrade; required: RequiredNodes;
  mobile: boolean; tooltipName?: string; tooltipEvents: TooltipEvents;
  setRequired: Dispatch<SetStateAction<RequiredNodes>>;
}) {
  function selectCount(name: string, count: SkillLevel) {
    setRequired(previous => {
      const selection = count === 4 ? 'all' : count || undefined;
      if (previous.get(name) === selection) return previous;
      const next = new Map(previous);
      if (selection === undefined) next.delete(name);
      else next.set(name, selection);
      return next;
    });
  }
  return <div id="required-options" role="tabpanel" aria-labelledby={`grade-${grade}`} className={`node-options ${grade}`}>
    {options.map(location => {
      const { name, type } = location.node;
      const selection = required.get(name);
      const count = selection === 'all' ? 4 : selection ?? 0;
      const selected = count > 0;
      const label = nodeLabel(name);
      const isSkill = type === 'SkillLevel';
      if (isSkill && grade !== '희귀') {
        return <div key={name} className={`skill-option${selected ? ' selected' : ''}`} {...tooltipEvents(location)}>
          <span className="option-name" title={label}>{label}</span>
          <div className={`skill-count-options${mobile ? ' skill-count-stepper' : ''}`} role="group" aria-label={`${label} 필수 노드 수`}>
            {mobile ? <>
              <button type="button" aria-label="레벨 낮추기" disabled={count === 0}
                onClick={() => selectCount(name, skillLevels[count - 1])}>−</button>
              <output>{count}</output>
              <button type="button" aria-label="레벨 높이기" disabled={count === 4}
                onClick={() => selectCount(name, skillLevels[count + 1])}>+</button>
            </> : skillLevels.map(value => <button key={value} type="button"
              aria-pressed={count === value}
              onClick={() => selectCount(name, value)}>
              {value}
            </button>)}
          </div>
        </div>;
      }
      return <button
        key={name}
        type="button"
        className={selected ? 'selected' : ''}
        aria-pressed={selected}
        aria-describedby={tooltipName === name ? 'node-tooltip' : undefined}
        {...tooltipEvents(location)}
        onClick={() => selectCount(name, selected ? 0 : 4)}
      >
        <span className="option-name">{label}</span>
        <span className={isSkill ? 'skill-count-value' : 'selection-mark'}>{isSkill ? (selected ? '4' : '0') : (selected ? '✓' : '+')}</span>
      </button>;
    })}
  </div>;
});

export default function App() {
  const mobile = isMobileDevice();
  const [initial] = useState(createInitialSettings);
  const [classKey, setClassKey] = useState(initial.classKey);
  const [points, setPoints] = useState(initial.points);
  const [boardKey, setBoardKey] = useState('nezakan');
  const [required, setRequired] = useState(initial.required);
  const [requiredGrade, setRequiredGrade] = useState<SpecialGrade>('유일');
  const [priority, setPriority] = useState<string[]>(initial.priority);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { tooltip, tooltipEvents, closeTooltip } = useNodeTooltip();
  const [result, setResult] = useState<CalculationResult | null>(null);
  const boardSection = useRef<HTMLElement>(null);
  const boards = useMemo(() => getBoards(classKey), [classKey]);
  const nodes = useMemo(() => boards.flatMap(b => b.nodeList), [boards]);
  const board = boards.find(b => b.boardKey === boardKey)!;
  const commonTotals = useMemo(() => countCommonNodes(nodes), [nodes]);
  const commonNames = useMemo(() => [...commonTotals.keys()].sort((a, b) => {
    const rank = (name: string) => {
      const index = defaultPriority.indexOf(name);
      return index < 0 ? defaultPriority.length : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b, 'ko');
  }), [commonTotals]);
  const requiredOptions = getRequiredNodeOptions(classKey).get(requiredGrade)!;
  const activeKeys = useMemo(() => new Set(result?.activeKeys ?? []), [result]);
  const boardTotalCosts = useMemo(() => new Map(boards.map(b => [b.boardKey, b.nodeList.reduce((sum, node) =>
    node.type === 'None' || node.type === 'Start'
      ? sum : sum + costs[node.grade as Grade], 0)])), [boards]);
  const { boardUsedPoints, effects } = useMemo(() => {
    const activeNodes: BoardNode[] = [];
    const boardUsedPoints = new Map<string, number>();
    for (const { boardKey, nodeList } of boards) {
      let usedPoints = 0;
      for (const node of nodeList) {
        if (!activeKeys.has(nodeKey(boardKey, node.nodeId)) && node.type !== 'Start') continue;
        activeNodes.push(node);
        if (node.type !== 'Start' && node.type !== 'None') usedPoints += costs[node.grade as Grade];
      }
      boardUsedPoints.set(boardKey, usedPoints);
    }
    return { boardUsedPoints, effects: summarizeEffects(activeNodes) };
  }, [boards, activeKeys]);
  const ordered = priority.length ? priority : commonNames;
  const settings = useMemo(() => ({
    classKey,
    availablePoints: points === '' ? 0 : Number(points),
    ...requiredNodeSettings(required),
    commonNodePriority: ordered,
  }), [classKey, points, required, ordered]);
  useLayoutEffect(() => {
    if (result) boardSection.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [result]);
  const commonCounts = ordered.map(name => ({
    name,
    total: commonTotals.get(name) ?? 0,
    active: result?.commonCounts.get(name) ?? 0,
  }));
  function move(name: string, to: number) {
    setPriority(prev => {
      const next = [...(prev.length ? prev : commonNames)]; const from = next.indexOf(name);
      if (from < 0 || to < 0 || to >= next.length || from === to) return prev;
      next.splice(from, 1); next.splice(to, 0, name); return next;
    });
  }
  function startDrag(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-priority]');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ name: row.dataset.priority!, x: rect.left, y: rect.top, width: rect.width, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
  }
  function dragMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    setDrag({ ...drag, x: e.clientX - drag.offsetX, y: e.clientY - drag.offsetY });
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-priority]'));
    const target = rows.findIndex(row => { const rect = row.getBoundingClientRect(); return e.clientY >= rect.top && e.clientY <= rect.bottom; });
    if (target < 0) return;
    const from = ordered.indexOf(drag.name); const rect = rows[target].getBoundingClientRect();
    if ((target > from && e.clientY > rect.top + rect.height / 2) || (target < from && e.clientY < rect.top + rect.height / 2)) move(drag.name, target);
  }
  function changeClass(key: string) {
    setClassKey(key); setRequired(defaultRequiredNodes(key)); setPriority([]); setDrag(null);
  }
  return <div className={mobile ? 'mobile' : 'desktop'}>
    <main>
      <div className="page-heading"><a className="github-link" href="https://github.com/kaizero-dev/aion2-daevanion-optimizer" target="_blank" rel="noopener noreferrer" aria-label="GitHub 저장소 열기 (새 탭)" title="GitHub 저장소"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.791-1.508-3.791-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.022-.699.077-.685.077-.685 1.13.08 1.725 1.16 1.725 1.16 1.004 1.72 2.634 1.223 3.275.935.102-.727.393-1.223.715-1.504-2.5-.285-5.129-1.25-5.129-5.566 0-1.23.44-2.234 1.16-3.022-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.155A10.78 10.78 0 0 1 12 6.176c.956.005 1.918.13 2.817.38 2.148-1.458 3.091-1.155 3.091-1.155.615 1.55.228 2.695.112 2.98.722.788 1.158 1.793 1.158 3.022 0 4.328-2.633 5.278-5.141 5.557.404.348.765 1.034.765 2.084 0 1.504-.014 2.718-.014 3.087 0 .3.202.65.774.54A11.253 11.253 0 0 0 12 .75Z" /></svg></a><div><div className="eyebrow">AION2 DAEVANION OPTIMIZER</div><h1>데바니온 최적화</h1><p>필수 노드와 우선순위를 설정하고, 최적화된 결과를 확인하세요.</p></div><div className="creator-credit"><span>만든 사람</span><strong>마몽[바바]</strong></div></div>
      <div className="workspace">
        <aside className="settings">
          <section className="panel setup"><div className="section-title"><span className="step">01</span><h2>캐릭터 설정</h2></div><div className="setup-fields"><label>직업<select value={classKey} onChange={e => changeClass(e.target.value)}>{classes.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label><label>총 가용 포인트<div className="point-input"><input type="number" min="0" step="1" placeholder="포인트 입력" value={points} onChange={e => setPoints(e.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(e.target.value)))))} /><span>P</span></div></label></div></section>
          <section className="panel required-panel"><div className="section-title"><span className="step">02</span><h2>필수 노드 지정</h2></div>
            <div className="grade-tabs" role="tablist" aria-label="필수 노드 등급">{specialGrades.map(grade => <button type="button" role="tab" id={`grade-${grade}`} aria-selected={requiredGrade === grade} aria-controls="required-options" className={`${grade} ${requiredGrade === grade ? 'active' : ''}`} key={grade} onClick={() => setRequiredGrade(grade)}><i className="grade-dot" />{grade}</button>)}</div>
            <RequiredNodeOptions options={requiredOptions} grade={requiredGrade} required={required} mobile={mobile}
              tooltipName={tooltip?.boardNames ? tooltip.node.name : undefined}
              tooltipEvents={tooltipEvents} setRequired={setRequired} />
            <p className="field-note">기기의 가용 자원에 따라 계산이 불가할 수 있습니다.</p>
          </section>
          <section className="panel priority-panel"><div className="section-title"><span className="step">03</span><h2>일반 노드 우선순위</h2></div><div className="priority-list" onPointerDown={startDrag} onPointerMove={dragMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}>{ordered.map((name,index) => <div className={`priority-item ${drag?.name === name ? 'dragging' : ''}`} key={name} data-priority={name}><span className="grip" aria-hidden="true">⠿</span><span className="rank">{index+1}</span><span className="priority-name">{name}</span><div className="order-controls"><button aria-label={`${name} 우선순위 올리기`} disabled={index===0} onClick={() => move(name,index-1)}>↑</button><button aria-label={`${name} 우선순위 내리기`} disabled={index===ordered.length-1} onClick={() => move(name,index+1)}>↓</button></div></div>)}</div><p className="field-note">상위 순위의 최대 개수를 유지하며 다음 순위를 최적화합니다.</p></section>
          <CalculationControls settings={settings} boards={boards} onResult={setResult} onStart={() => { closeTooltip(); setDrag(null); }} />
        </aside>
        <section ref={boardSection} className="board-section" aria-label="데바니온 보드">
          <div className="panel board-panel">
            <div className="board-tabs" role="tablist" aria-label="데바니온 보드">
              {boards.map(({ boardKey: key, boardName }) => {
                const selected = boardKey === key;
                const total = boardTotalCosts.get(key)!;
                const used = boardUsedPoints.get(key)!;
                return <button type="button" role="tab" aria-selected={selected} key={key}
                  onClick={() => setBoardKey(key)} className={selected ? 'active' : ''}>
                  <span className="board-tab-name">{boardName}</span>
                  <span className="board-tab-points" aria-label={`${boardName} 포인트 현황`}>
                    {result ? <>
                      <span>사용 <strong>{used.toLocaleString()}P</strong></span>
                      <span className="point-separator">·</span>
                      <span className="board-points-needed">필요 {(total - used).toLocaleString()}P</span>
                    </> : <span><strong>{total.toLocaleString()}P</strong></span>}
                  </span>
                </button>;
              })}
            </div>
            <BoardGrid board={board} classKey={classKey} activeKeys={activeKeys} tooltipNodeId={tooltip?.boardName ? tooltip.node.nodeId : undefined} tooltipEvents={tooltipEvents} />
          </div>
        </section>
      </div>
      <hr className="workspace-divider" />
      <section className="panel result-summary" aria-labelledby="summary-title">
        <div className="summary-heading"><h2 id="summary-title">최적화 결과 요약</h2>{result && <span className={`remaining-points desktop-remaining-points ${Number(points) > result.usedPoints ? 'has-remaining' : ''}`}>잔여 <strong>{(Number(points) - result.usedPoints).toLocaleString()}P</strong></span>}</div>
        <div className="summary-columns">
          <section className="effects-summary"><h3>총 적용 효과</h3>{effects.length ? <ul className="applied-effects">{effects.map((effect, index) => <li key={`${index}:${effect}`}>{effect}</li>)}</ul> : <div className="empty-effects"><span aria-hidden="true">◇</span><p>아직 적용된 효과가 없습니다.</p></div>}</section>
          <section className="counts-summary"><div className="counts-heading"><h3>일반 노드 습득 현황</h3>{result && <span className={`remaining-points mobile-remaining-points ${Number(points) > result.usedPoints ? 'has-remaining' : ''}`}>잔여 <strong>{(Number(points) - result.usedPoints).toLocaleString()}P</strong></span>}</div><table aria-label="일반 노드별 활성 개수와 전체 개수"><tbody>{commonCounts.map(({name,active,total}) => <tr key={name}><th scope="row">{name}</th><td aria-label={`활성 ${active}개`}>{active}</td><td aria-label={`전체 ${total}개`}>{total}</td></tr>)}</tbody></table></section>
        </div>
      </section>
    </main><footer><span><time dateTime="2026-11-11">2026.11.11</time> 패치 기준</span></footer>
    {tooltip && <NodeTooltip {...tooltip} mobile={mobile} />}
    {drag && createPortal(<div className="priority-item drag-overlay" aria-hidden="true" style={{ left: drag.x, top: drag.y, width: drag.width }}><span className="grip">⠿</span><span className="rank">{ordered.indexOf(drag.name)+1}</span><span className="priority-name">{drag.name}</span></div>, document.body)}
  </div>;
}
