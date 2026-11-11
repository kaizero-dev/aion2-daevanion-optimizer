import { defineConfig } from 'vite';
import type { SourceBoard } from './src/grades';

export default defineConfig({
  plugins: [{
    name: 'board-runtime-fields',
    enforce: 'pre',
    transform(source, id) {
      if (!/\/data\/boards\/[^/]+\/[^/]+\.json$/.test(id)) return;
      const board: SourceBoard = JSON.parse(source);
      // Keep source files intact; ship only fields consumed by the app and Worker.
      return { code: JSON.stringify({
        boardKey: board.boardKey,
        boardName: board.boardName,
        nodeList: board.nodeList.map(({ nodeId, row, col, name, grade, type, effectList }) =>
          ({ nodeId, row, col, name, grade, type, effectList })),
      }), map: null };
    },
  }],
});
