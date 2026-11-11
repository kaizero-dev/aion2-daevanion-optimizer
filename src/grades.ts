export type Grade = 'Common' | '희귀' | '전승' | '유일';
export interface BoardNode {
  nodeId: number; row: number; col: number; name: string;
  grade: Grade | 'None'; type: string; effectList: { desc: string }[];
}
export interface Board { boardKey: string; boardName: string; nodeList: BoardNode[] }
export interface SourceBoard extends Omit<Board, 'nodeList'> { nodeList: (Omit<BoardNode, 'grade'> & { grade: string })[] }
export const specialGrades = ['유일', '전승', '희귀'] as const;
export const gradeNames: Record<Grade, string> = { Common: 'Common', 희귀: '희귀', 전승: '전승', 유일: '유일' };
export const gradeOrder: Record<Grade | 'None', number> = { 유일: 0, 전승: 1, 희귀: 2, Common: 3, None: 4 };

// The unchanged source schema assigns exactly 1/2/3/4 points to the four grades.
// Read its original keys from the manifest; keep domain values Korean everywhere.
export function createGradeAdapter(sourceCosts: Record<string, number>) {
  const byCost: Record<number, Grade> = { 1: 'Common', 2: '희귀', 3: '전승', 4: '유일' };
  const sourceToGrade = new Map<string, Grade>();
  const gradeToSource = new Map<Grade, string>();
  const costs = {} as Record<Grade, number>;
  for (const [source, cost] of Object.entries(sourceCosts)) {
    const grade = byCost[cost];
    if (!grade || gradeToSource.has(grade)) throw new Error('Unsupported source grade costs');
    sourceToGrade.set(source, grade); gradeToSource.set(grade, source); costs[grade] = cost;
  }
  if (gradeToSource.size !== 4) throw new Error('Incomplete source grades');
  function normalizeBoard(board: SourceBoard): Board {
    return { ...board, nodeList: board.nodeList.map(node => {
      const grade = node.grade === 'None' ? 'None' : sourceToGrade.get(node.grade)
        ?? (Object.hasOwn(gradeNames, node.grade) ? node.grade as Grade : undefined);
      if (!grade) throw new Error('Unknown source grade');
      return { ...node, grade };
    }) };
  }
  return { costs, normalizeBoard, sourceGrade: (grade: Grade) => gradeToSource.get(grade)! };
}
