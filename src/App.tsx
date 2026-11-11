import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { classes, getBoards, gradeNames, iconFor, type BoardNode, type Grade } from './data';

type Drag = { name: string; x: number; y: number; width: number; offsetX: number; offsetY: number };
type Tooltip = { node: BoardNode; anchor: DOMRect; pointer?: { x: number; y: number }; boardNames?: string[] };
const defaultPriority = ['공격력', '치명타', '방어력', '최대 생명력', '최대 정신력', '치명타 저항'];
function NodeTooltip({ node, anchor, pointer, boardNames }: Tooltip) {
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
  return createPortal(<div ref={ref} id="node-tooltip" role="tooltip" className={`node-tooltip ${node.grade.toLowerCase()}`} style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>
    {!boardNames && <strong>{node.name.replace(/^스킬 레벨 상승 - /,'')}</strong>}<div className={`tooltip-description ${boardNames ? 'boards-only' : ''}`}>{boardNames ? <p>{boardNames.join(' · ')}</p> : node.type === 'Start' ? <p>항상 활성화되는 시작 노드</p> : node.effectList.filter(e => e.desc).map((effect, i) => <p key={i}>{effect.desc}</p>)}</div>
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
  const commonNames = useMemo(() => [...new Set(nodes.filter(n => n.grade === 'Common').map(n => n.name))].sort((a,b) => {
    const rank = (name: string) => defaultPriority.includes(name) ? defaultPriority.indexOf(name) : defaultPriority.length;
    return rank(a) - rank(b) || a.localeCompare(b, 'ko');
  }), [nodes]);
  const requiredNodeTypes = useMemo(() => new Map(nodes.map(n => [n.name, n.type])), [nodes]);
  const requiredLocations = useMemo(() => new Map(nodes.filter(n => n.grade !== 'Common' && n.grade !== 'None').map(node => [node.name, {
    node,
    boardNames: boards.filter(b => b.nodeList.some(n => n.name === node.name)).map(b => b.boardName),
  }])), [nodes, boards]);
  // Until the optimizer is implemented, only the free start nodes are active.
  const activeNodes = nodes.filter(n => n.type === 'Start');
  const ordered = priority.length ? priority : commonNames;
  const commonCounts = ordered.map(name => ({
    name,
    total: nodes.filter(n => n.grade === 'Common' && n.name === name).length,
    active: activeNodes.filter(n => n.grade === 'Common' && n.name === name).length,
  }));
  const requiredNames = useMemo(() => [...new Set(nodes.filter(n => n.grade === requiredGrade).map(n => n.name))].sort((a,b) => a.localeCompare(b, 'ko')), [nodes, requiredGrade]);
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
    <a className="github-link" href="https://github.com/kaizero-dev/aion2-daevanion-optimization" target="_blank" rel="noopener noreferrer" aria-label="GitHub 저장소 열기 (새 탭)" title="GitHub 저장소"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.791-1.508-3.791-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.022-.699.077-.685.077-.685 1.13.08 1.725 1.16 1.725 1.16 1.004 1.72 2.634 1.223 3.275.935.102-.727.393-1.223.715-1.504-2.5-.285-5.129-1.25-5.129-5.566 0-1.23.44-2.234 1.16-3.022-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.155A10.78 10.78 0 0 1 12 6.176c.956.005 1.918.13 2.817.38 2.148-1.458 3.091-1.155 3.091-1.155.615 1.55.228 2.695.112 2.98.722.788 1.158 1.793 1.158 3.022 0 4.328-2.633 5.278-5.141 5.557.404.348.765 1.034.765 2.084 0 1.504-.014 2.718-.014 3.087 0 .3.202.65.774.54A11.253 11.253 0 0 0 12 .75Z" /></svg></a>
    <main>
      <div className="page-heading"><div><div className="eyebrow">DAEVANION PLANNER</div><h1>데바니온 최적화</h1><p>필수 노드와 노드 우선순위를 설정하고, 최적화된 결과를 확인하세요.</p></div><div className="creator-credit"><span>만든 사람</span><strong>마몽[바바]</strong></div></div>
      <div className="workspace">
        <aside className="settings">
          <section className="panel setup"><div className="section-title"><span className="step">01</span><h2>캐릭터 설정</h2></div><div className="setup-fields"><label>직업<select value={classKey} onChange={e => changeClass(e.target.value)}>{classes.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label><label>총 가용 포인트<div className="point-input"><input type="number" min="0" step="1" placeholder="포인트 입력" value={points} onChange={e => setPoints(e.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(e.target.value)))))} /><span>P</span></div></label></div></section>
          <section className="panel required-panel"><div className="section-title"><span className="step">02</span><h2>필수 노드 지정</h2></div>
            <div className="grade-tabs" role="tablist" aria-label="필수 노드 등급">{(['Unique','Legend','Rare'] as Grade[]).map(grade => <button type="button" role="tab" id={`grade-${grade}`} aria-selected={requiredGrade === grade} aria-controls="required-options" className={`${grade.toLowerCase()} ${requiredGrade === grade ? 'active' : ''}`} key={grade} onClick={() => { setRequiredGrade(grade); setTooltip(null); }}><i className="grade-dot" />{grade}</button>)}</div>
            <div id="required-options" role="tabpanel" aria-labelledby={`grade-${requiredGrade}`} className={`node-options ${requiredGrade.toLowerCase()}`}>{requiredNames.map(name => {
              const isSkill = requiredNodeTypes.get(name) === 'SkillLevel';
              return <button key={name} className={required.includes(name) ? 'selected' : ''} aria-pressed={required.includes(name)} aria-describedby={tooltip?.boardNames && tooltip.node.name === name ? 'node-tooltip' : undefined} onMouseEnter={e => setTooltip({ pointer: { x:e.clientX, y:e.clientY }, ...requiredLocations.get(name)!, anchor:e.currentTarget.getBoundingClientRect() })} onMouseMove={e => { const pointer = { x:e.clientX, y:e.clientY }; setTooltip(prev => prev ? { ...prev, pointer } : prev); }} onMouseLeave={() => setTooltip(null)} onFocus={e => setTooltip({ ...requiredLocations.get(name)!, anchor:e.currentTarget.getBoundingClientRect() })} onBlur={() => setTooltip(null)} onKeyDown={e => { if (e.key === 'Escape') setTooltip(null); }} onClick={() => setRequired(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev,name])}><span className="option-name">{name.replace(/^스킬 레벨 상승 - /,'')}{isSkill && <span className="skill-increment"> +1</span>}</span><span className="selection-mark">{required.includes(name) ? '✓' : '+'}</span></button>;
            })}</div>
          </section>
          <section className="panel priority-panel"><div className="section-title"><span className="step">03</span><h2>일반 노드 우선순위</h2></div><div className="priority-list" onPointerDown={startDrag} onPointerMove={dragMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}>{ordered.map((name,index) => <div className={`priority-item ${drag?.name === name ? 'dragging' : ''}`} key={name} data-priority={name}><span className="grip" aria-hidden="true">⠿</span><span className="rank">{index+1}</span><span className="priority-name">{name}</span><div className="order-controls"><button aria-label={`${name} 우선순위 올리기`} disabled={index===0} onClick={() => move(name,index-1)}>↑</button><button aria-label={`${name} 우선순위 내리기`} disabled={index===ordered.length-1} onClick={() => move(name,index+1)}>↓</button></div></div>)}</div><p className="field-note">높은 순위를 모두 달성한 뒤 다음 순위를 목표로 합니다.</p></section>
          <button className="calculate" type="button">최적화 계산<span>→</span></button>
        </aside>
        <section className="board-section" aria-label="데바니온 보드">
          <div className="panel board-panel"><div className="board-tabs" role="tablist" aria-label="데바니온 보드">{boards.map(b => <button role="tab" aria-selected={boardKey===b.boardKey} key={b.boardKey} onClick={() => { setBoardKey(b.boardKey); setTooltip(null); }} className={boardKey===b.boardKey ? 'active' : ''}>{b.boardName}</button>)}</div>
            <div className="board-viewport" onScroll={() => setTooltip(null)}><div className="board-grid">{board.nodeList.filter(n => n.type !== 'None').map(n => <button key={n.nodeId} className={`board-node ${n.type==='Start' ? 'start-node' : ''}`} style={{gridRow:n.row,gridColumn:n.col}} aria-label={`${n.name}, ${n.type==='Start' ? '시작 노드' : gradeNames[n.grade as Grade]}`} aria-describedby={tooltip?.node.nodeId === n.nodeId ? 'node-tooltip' : undefined} onMouseEnter={e => setTooltip({ pointer: { x:e.clientX, y:e.clientY }, node:n, anchor:e.currentTarget.getBoundingClientRect() })} onMouseMove={e => { const pointer = { x:e.clientX, y:e.clientY }; setTooltip(prev => prev ? { ...prev, pointer } : prev); }} onMouseLeave={() => setTooltip(null)} onFocus={e => setTooltip({ node:n, anchor:e.currentTarget.getBoundingClientRect() })} onBlur={() => setTooltip(null)} onKeyDown={e => { if(e.key === 'Escape') setTooltip(null); }} onClick={e => setTooltip({ pointer: e.detail ? { x:e.clientX, y:e.clientY } : undefined, node:n, anchor:e.currentTarget.getBoundingClientRect() })}><img src={iconFor(n,classKey)} alt="" draggable={false} /></button>)}</div></div>
          </div>
        </section>
      </div>
      <section className="panel result-summary" aria-labelledby="summary-title">
        <div className="summary-heading"><h2 id="summary-title">최적화 결과 요약</h2><span>5개 보드 전체 합산</span></div>
        <div className="summary-columns">
          <section className="effects-summary"><h3>총 적용 효과</h3><div className="empty-effects"><span aria-hidden="true">◇</span><p>아직 적용된 효과가 없습니다.</p></div></section>
          <section className="counts-summary"><h3>일반 노드 활성 현황</h3><table aria-label="일반 노드별 활성 개수와 전체 개수"><tbody>{commonCounts.map(({name,active,total}) => <tr key={name}><th scope="row">{name}</th><td aria-label={`활성 ${active}개`}>{active}</td><td aria-label={`전체 ${total}개`}>{total}</td></tr>)}</tbody></table></section>
        </div>
      </section>
    </main><footer><span><time dateTime="2026-11-11">2026.11.11</time> 패치 기준</span></footer>
    {tooltip && <NodeTooltip {...tooltip} />}
    {drag && createPortal(<div className="priority-item drag-overlay" aria-hidden="true" style={{ left: drag.x, top: drag.y, width: drag.width }}><span className="grip">⠿</span><span className="rank">{ordered.indexOf(drag.name)+1}</span><span className="priority-name">{drag.name}</span></div>, document.body)}
  </div>;
}
