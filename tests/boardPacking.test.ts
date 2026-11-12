import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packBoards, unpackBoard } from '../src/boardPacking.ts';
import { manifest, adapter } from './testData.ts';
import type { SourceBoard } from '../src/grades.ts';

test('packed data preserves every runtime field and node order in all 45 source boards', () => {
  const originals: Record<string, SourceBoard> = {};
  for (const character of manifest.classes) for (const board of character.boards) {
    originals[`${character.key}/${board.key}`] = JSON.parse(readFileSync(
      new URL(`../data/boards/${character.key}/${board.key}.json`, import.meta.url), 'utf8'));
  }
  // Include the JSON serialization boundary used by the generated Vite module.
  const packed = JSON.parse(JSON.stringify(packBoards(originals)));
  assert.equal(Object.keys(packed.boards).length, 45);
  for (const [key, original] of Object.entries(originals)) {
    const expected = {
      boardKey: original.boardKey, boardName: original.boardName,
      nodeList: original.nodeList.map(({ nodeId, row, col, name, grade, type, effectList }) =>
        ({ nodeId, row, col, name, grade, type, effectList })),
    };
    const restored = unpackBoard(packed, key);
    assert.deepEqual(restored, expected, key);
    assert.deepEqual(adapter.normalizeBoard(restored), adapter.normalizeBoard(expected), key);
  }
});
