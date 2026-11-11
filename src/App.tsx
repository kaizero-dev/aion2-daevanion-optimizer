import { useMemo, useState } from 'react';
import { classes, costs, getBoards, gradeNames, iconFor, type BoardNode, type Grade } from './data';

export default function App() {
  const [classKey, setClassKey] = useState('gladiator');
  const [points, setPoints] = useState('');
  const [boardKey, setBoardKey] = useState('nezakan');
  const [required, setRequired] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [focused, setFocused] = useState<BoardNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const boards = useMemo(() => getBoards(classKey), [classKey]);
  const nodes = useMemo(() => boards.flatMap(b => b.nodeList), [boards]);
  const board = boards.find(b => b.boardKey === boardKey)!;
  const commonNames = useMemo(() => [...new Set(nodes.filter(n => n.grade === 'Common').map(n => n.name))].sort((a,b) => a.localeCompare(b, 'ko')), [nodes]);
  const ordered = priority.length ? priority : commonNames;
  const selectedClass = classes.find(c => c.key === classKey)!;
  function move(name: string, to: number) {
    const next = [...ordered]; const from = next.indexOf(name);
    if (from < 0 || to < 0 || to >= next.length) return;
    next.splice(from, 1); next.splice(to, 0, name); setPriority(next);
  }
  function changeClass(key: string) {
    setClassKey(key); setRequired([]); setPriority([]); setFocused(null);
  }
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="./"><span className="brand-mark">✧</span><span>AION<span className="brand-two">2</span><small>DAEVANION</small></span></a><span className="header-divider" /><span className="header-title">데바니온 최적화</span><span className="header-note">나만의 성장 경로를 설계하세요</span></header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">DAEVANION PLANNER</div><h1>가능성을 연결하다<span>.</span></h1><p>필수 노드와 성장 우선순위를 설정하고, 데바니온 보드를 확인하세요.</p></div><div className="heading-tag"><i /> 5개 보드 · 하나의 성장 경로</div></div>
      <div className="workspace">
        <aside className="settings">
          <section className="panel setup"><div className="section-title"><span className="step">01</span><h2>캐릭터 설정</h2></div><div className="setup-fields"><label>직업<select value={classKey} onChange={e => changeClass(e.target.value)}>{classes.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label><label>총 가용 포인트<div className="point-input"><input type="number" min="0" step="1" placeholder="포인트 입력" value={points} onChange={e => setPoints(e.target.value === '' ? '' : String(Math.max(0, Math.trunc(Number(e.target.value)))))} /><span>P</span></div></label></div><p className="field-note">가용 포인트는 5개 보드가 함께 사용합니다.</p></section>
          <section className="panel required-panel"><div className="section-title"><span className="step">02</span><h2>필수 노드</h2><span className="count">{required.length}개 선택</span></div><p className="section-description">반드시 활성화할 노드를 선택하세요.<br />같은 이름의 모든 노드에 적용됩니다.</p><div className="grade-groups">{(['Unique','Legend','Rare'] as Grade[]).map(grade => {
            const names = [...new Set(nodes.filter(n => n.grade === grade).map(n => n.name))].sort((a,b) => a.localeCompare(b,'ko'));
            return <div className={`grade-group ${grade.toLowerCase()}`} key={grade}><div className="grade-heading"><span className="grade-dot" />{gradeNames[grade]}<span>{costs[grade]}P / 노드</span></div><div className="node-options">{names.map(name => <button key={name} className={required.includes(name) ? 'selected' : ''} aria-pressed={required.includes(name)} onClick={() => setRequired(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev,name])}>{name.replace(/^스킬 레벨 상승 - /,'')}<span>{required.includes(name) ? '✓' : '+'}</span></button>)}</div></div>;
          })}</div></section>
          <section className="panel priority-panel"><div className="section-title"><span className="step">03</span><h2>일반 노드 우선순위</h2></div><p className="section-description">드래그하여 원하는 성장 순서를 정하세요.</p><div className="priority-list">{ordered.map((name,index) => <div className={`priority-item ${dragged === name ? 'dragging' : ''}`} key={name} draggable onDragStart={e => { setDragged(name); e.dataTransfer.setData('text/plain',name); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragged(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(e.dataTransfer.getData('text/plain'),index); setDragged(null); }}><span className="grip" aria-hidden="true">⠿</span><span className="rank">{index+1}</span><span className="priority-name">{name}</span><div className="order-controls"><button aria-label={`${name} 우선순위 올리기`} disabled={index===0} onClick={() => move(name,index-1)}>↑</button><button aria-label={`${name} 우선순위 내리기`} disabled={index===ordered.length-1} onClick={() => move(name,index+1)}>↓</button></div></div>)}</div><p className="field-note">높은 순위를 모두 달성한 뒤 다음 순위를 목표로 합니다.</p></section>
          <button className="calculate" type="button">최적 경로 계산<span>→</span></button>
        </aside>
        <section className="board-section">
          <div className="panel board-panel"><div className="board-topline"><div><div className="eyebrow">DAEVANION BOARD</div><h2>{selectedClass.name}의 데바니온</h2></div><span className="board-class"><img src={iconFor({type:'Start'} as BoardNode,classKey)} alt="" />{selectedClass.name}</span></div><div className="board-tabs" role="tablist" aria-label="데바니온 보드">{boards.map((b,i) => <button role="tab" aria-selected={boardKey===b.boardKey} key={b.boardKey} onClick={() => { setBoardKey(b.boardKey); setFocused(null); }} className={boardKey===b.boardKey ? 'active' : ''}><span>0{i+1}</span>{b.boardName}</button>)}</div>
          <div className="board-toolbar"><span><i />{board.boardName}<small>15 × 15</small></span><div className="zoom-controls"><button aria-label="보드 축소" disabled={zoom<=1} onClick={() => setZoom(z => Math.max(1,z-0.25))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="보드 확대" disabled={zoom>=2} onClick={() => setZoom(z => Math.min(2,z+0.25))}>+</button></div></div>
          <div className="board-viewport"><div className="board-grid" style={{width:`${zoom*100}%`}}>{board.nodeList.filter(n => n.type !== 'None').map(n => <button key={n.nodeId} className={`board-node ${n.type==='Start' ? 'start-node' : ''} ${focused?.nodeId===n.nodeId ? 'inspected' : ''}`} style={{gridRow:n.row,gridColumn:n.col}} aria-label={`${n.name}, ${n.type==='Start' ? '시작 노드' : gradeNames[n.grade as Grade]}`} title={[n.name,...n.effectList.map(e => e.desc)].filter(Boolean).join('\n')} onClick={() => setFocused(n)}><img src={iconFor(n,classKey)} alt="" draggable={false} /></button>)}</div></div>
          <div className="board-legend"><span><i className="legend-start" />시작 노드</span>{(['Common','Rare','Legend','Unique'] as Grade[]).map(g => <span className={g.toLowerCase()} key={g}><i className="grade-dot" />{gradeNames[g]}<small>{costs[g]}P</small></span>)}</div>
          <div className="node-detail" aria-live="polite">{focused ? <><span className="detail-symbol">◇</span><div><strong>{focused.name}</strong><p>{focused.type==='Start' ? '항상 활성화되는 시작 노드 · 0P' : `${gradeNames[focused.grade as Grade]} · ${costs[focused.grade as Grade]}P · ${focused.effectList.map(e => e.desc).filter(Boolean).join(' / ')}`}</p></div><span className="coordinate">{focused.row}행 {focused.col}열</span></> : <><span className="detail-symbol">⌖</span><div><strong>노드를 선택해 자세히 살펴보세요</strong><p>노드의 효과와 활성화 비용을 확인할 수 있습니다.</p></div></>}</div></div>
          <div className="board-bottom-note"><span>✧</span><p>작은 선택들이 모여, 당신만의 데바니온이 됩니다.</p><span>시작 노드 무료 · 상하좌우 연결</span></div>
        </section>
      </div>
    </main><footer><span>AION2 DAEVANION PLANNER</span><span>본 사이트는 비공식 팬 프로젝트입니다.</span></footer>
  </div>;
}
