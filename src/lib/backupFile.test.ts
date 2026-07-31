import { describe, it, expect } from 'vitest';
import { parseBackupFile } from './backupFile';

// jsdom's File/Blob doesn't implement .text() — parseBackupFile only needs that one
// method, so patch it directly rather than pulling in a full polyfill for the suite.
const jsonFile = (text: string): File => {
  const file = new File([text], 'backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  return file;
};

const validExport = JSON.stringify({
  __app: 'fittrack',
  __version: 1,
  data: {
    workoutTypes: [{ id: 't1', name: 'Legs', color: '189 94% 55%', exercises: [] }],
    sessions: [],
  },
});

describe('parseBackupFile', () => {
  it('extracts data from the wrapped export format ({ __app, data })', async () => {
    const imported = await parseBackupFile(jsonFile(validExport));
    expect(imported.workoutTypes).toHaveLength(1);
    expect(imported.sessions).toEqual([]);
  });

  it('also accepts a bare AppData object (no wrapper)', async () => {
    const bare = JSON.stringify({ workoutTypes: [], sessions: [] });
    const imported = await parseBackupFile(jsonFile(bare));
    expect(imported.workoutTypes).toEqual([]);
  });

  it('strips a leading BOM before parsing', async () => {
    const imported = await parseBackupFile(jsonFile('﻿' + validExport));
    expect(imported.workoutTypes).toHaveLength(1);
  });

  it('surfaces the JSON.parse error message on invalid JSON (e.g. smart quotes from Notes/Mail)', async () => {
    const corrupted = validExport.replace('"__app"', '“__app”');
    await expect(parseBackupFile(jsonFile(corrupted))).rejects.toThrow(/JSON illisible/);
  });

  it('rejects valid JSON that has no recognizable workoutTypes/sessions', async () => {
    await expect(parseBackupFile(jsonFile(JSON.stringify({ foo: 'bar' }))))
      .rejects.toThrow(/Structure inattendue/);
  });
});
