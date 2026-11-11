import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { classes, getBoards, gradeNames, iconFor, type BoardNode, type Grade } from './data';

type Drag = { name: string; x: number; y: number; width: number; offsetX: number; offsetY: number };
type Tooltip = { node: BoardNode; anchor: DOMRect };
function NodeTooltip({ node, anchor }: Tooltip) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right + 10, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8));
    setPosition({ left, top, ready: true });
  }, [anchor]);
  return createPortal(<div ref={ref} id="node-tooltip" role="tooltip" className={`node-tooltip ${node.grade.toLowerCase()}`} style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>
    <strong>{node.name}</strong><div className="tooltip-description">{node.type === 'Start' ? <p>항상 활성화되는 시작 노드</p> : node.effectList.filter(e => e.desc).map((effect, i) => <p key={i}>{effect.desc}</p>)}</div>
  </div>, document.body);
}
export default function App() {
  const [classKey, setClassKey] = useState('gladiator');
  const [points, setPoints] = useState('');
  const [boardKey, setBoardKey] = useState('nezakan');
  const [required, setRequired] = useState<string[]>([]);
  const [requiredGrade, setRequiredGrade] = useState<Grade>('Unique');
  const [priority, setPriority] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const boards = useMemo(() => getBoards(classKey), [classKey]);
  const nodes = useMemo(() => boards.flatMap(b => b.nodeList), [boards]);
  const board = boards.find(b => b.boardKey === boardKey)!;
  const commonNames = useMemo(() => [...new Set(nodes.filter(n => n.grade === 'Common').map(n => n.name))].sort((a,b) => a.localeCompare(b, 'ko')), [nodes]);
  const requiredNames = useMemo(() => [...new Set(nodes.filter(n => n.grade === requiredGrade).map(n => n.name))].sort((a,b) => a.localeCompare(b, 'ko')), [nodes, requiredGrade]);
  const ordered = priority.length ? priority : commonNames;
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
    setClassKey(key); setRequired([]); setPriority([]); setTooltip(null); setDrag(null);
  }
  return <div className="app-shell">
    <main>
      <div className="page-heading"><div><div className="eyebrow">DAEVANION PLANNER</div><h1>데바니온 최적화</h1><p>필수 노드와 노드 우선순위를 설정하고, 최적화 결과를 확인하세요.</p></div><div className="heading-tag"><i /> 5개 보드 · 하나의 성장 경로</div></div>
      <div className="workspace">
        <aside className="settings">
          <section className="panel setup"><div className="section-title"><span className="step">01</span><h2>캐릭터 설정</h2></div><div className="setup-fields"><label>직업<select value={classKey} onChange={e => changeClass(e.target.value)}>{classes.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label><label>총 가용 포인트<div className="point-input"><input type="number" min="0" step="1" placeholder="포인트 입력" value={points} onChange={e => setPoints(e.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(e.target.value)))))} /><span>P</span></div></label></div></section>
          <section className="panel required-panel"><div className="section-title"><span className="step">02</span><h2>필수 노드</h2></div><p className="section-description">반드시 활성화할 노드를 선택하세요.</p>
            <div className="grade-tabs" role="tablist" aria-label="필수 노드 등급">{(['Unique','Legend','Rare'] as Grade[]).map(grade => <button type="button" role="tab" id={`grade-${grade}`} aria-selected={requiredGrade === grade} aria-controls="required-options" className={`${grade.toLowerCase()} ${requiredGrade === grade ? 'active' : ''}`} key={grade} onClick={() => setRequiredGrade(grade)}><i className="grade-dot" />{grade}</button>)}</div>
            <div id="required-options" role="tabpanel" aria-labelledby={`grade-${requiredGrade}`} className={`node-options ${requiredGrade.toLowerCase()}`}>{requiredNames.map(name => <button key={name} className={required.includes(name) ? 'selected' : ''} aria-pressed={required.includes(name)} onClick={() => setRequired(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev,name])}>{name.replace(/^스킬 레벨 상승 - /,'')}<span>{required.includes(name) ? '✓' : '+'}</span></button>)}</div>
          </section>
          <section className="panel priority-panel"><div className="section-title"><span className="step">03</span><h2>Common 노드 우선순위</h2></div><p className="section-description">드래그하여 원하는 성장 순서를 정하세요.</p><div className="priority-list" onPointerDown={startDrag} onPointerMove={dragMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}>{ordered.map((name,index) => <div className={`priority-item ${drag?.name === name ? 'dragging' : ''}`} key={name} data-priority={name}><span className="grip" aria-hidden="true">⠿</span><span className="rank">{index+1}</span><span className="priority-name">{name}</span><div className="order-controls"><button aria-label={`${name} 우선순위 올리기`} disabled={index===0} onClick={() => move(name,index-1)}>↑</button><button aria-label={`${name} 우선순위 내리기`} disabled={index===ordered.length-1} onClick={() => move(name,index+1)}>↓</button></div></div>)}</div><p className="field-note">높은 순위를 모두 달성한 뒤 다음 순위를 목표로 합니다.</p></section>
          <button className="calculate" type="button">최적 경로 계산<span>→</span></button>
        </aside>
        <section className="board-section" aria-label="데바니온 보드">
          <div className="panel board-panel"><div className="board-tabs" role="tablist" aria-label="데바니온 보드">{boards.map(b => <button role="tab" aria-selected={boardKey===b.boardKey} key={b.boardKey} onClick={() => { setBoardKey(b.boardKey); setTooltip(null); }} className={boardKey===b.boardKey ? 'active' : ''}>{b.boardName}</button>)}</div>
            <div className="board-viewport" onScroll={() => setTooltip(null)}><div className="board-grid">{board.nodeList.filter(n => n.type !== 'None').map(n => <button key={n.nodeId} className={`board-node ${n.type==='Start' ? 'start-node' : ''}`} style={{gridRow:n.row,gridColumn:n.col}} aria-label={`${n.name}, ${n.type==='Start' ? '시작 노드' : gradeNames[n.grade as Grade]}`} aria-describedby={tooltip?.node.nodeId === n.nodeId ? 'node-tooltip' : undefined} onMouseEnter={e => setTooltip({ node:n, anchor:e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setTooltip(null)} onFocus={e => setTooltip({ node:n, anchor:e.currentTarget.getBoundingClientRect() })} onBlur={() => setTooltip(null)} onKeyDown={e => { if(e.key === 'Escape') setTooltip(null); }} onClick={e => setTooltip({ node:n, anchor:e.currentTarget.getBoundingClientRect() })}><img src={iconFor(n,classKey)} alt="" draggable={false} /></button>)}</div></div>
          </div>
        </section>
      </div>
    </main><footer><span>AION2 DAEVANION PLANNER</span><span>본 사이트는 비공식 팬 프로젝트입니다.</span></footer>
    {tooltip && <NodeTooltip {...tooltip} />}
    {drag && createPortal(<div className="priority-item drag-overlay" aria-hidden="true" style={{ left: drag.x, top: drag.y, width: drag.width }}><span className="grip">⠿</span><span className="rank">{ordered.indexOf(drag.name)+1}</span><span className="priority-name">{drag.name}</span></div>, document.body)}
  </div>;
}
