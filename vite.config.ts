import { defineConfig } from 'vite';
import type { SourceBoard } from './src/grades';
// @ts-expect-error Node is available in Vite's config runtime; this app has no Node typings.
import { readFileSync } from 'node:fs';
import manifest from './data/manifest.json';
import { packBoards } from './src/boardPacking';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Keep embedded, eagerly available icons cached across app/data updates.
        manualChunks(id) {
          if (/\/assets\/board_icon_start_[^/]+\.webp\?/.test(id)) return 'start-icons';
        },
      },
    },
  },
  plugins: [{
    name: 'packed-boards',
    resolveId(id) {
      if (id === 'virtual:packed-boards') return '\0virtual:packed-boards';
    },
    load(id) {
      if (id !== '\0virtual:packed-boards') return;
      const boards: Record<string, SourceBoard> = {};
      for (const character of manifest.classes) for (const board of character.boards) {
        const path = new URL(`./data/boards/${character.key}/${board.key}.json`, import.meta.url);
        this.addWatchFile(decodeURIComponent(path.pathname).replace(/^\/([A-Za-z]:)/, '$1'));
        boards[`${character.key}/${board.key}`] = JSON.parse(readFileSync(path, 'utf8'));
      }
      return `export default ${JSON.stringify(packBoards(boards))};`;
    },
  }],
});
