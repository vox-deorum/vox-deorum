import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseNewspaperOptions } from '../../../../src/newspaper/cli/options.js';

const required = ['--database', 'recording.sqlite', '--output', 'examples', '--player', '0', '--to', '30'];

describe('newspaper command options', () => {
  it('should resolve recording, output and catalogue paths from the invoking directory', () => {
    const directory = path.resolve('caller');
    const options = parseNewspaperOptions([...required, '--config', 'catalogue', '--render-turns', '10,20,10'], directory)!;
    expect(options).toMatchObject({ database: path.join(directory, 'recording.sqlite'), output: path.join(directory, 'examples'),
      config: path.join(directory, 'catalogue'), player: 0, from: 0, to: 30, every: 5, comparison: 10, renderTurns: [10, 20] });
  });

  it('should accept a zero-length replay and explicit recorded comparison window', () => {
    expect(parseNewspaperOptions([...required.slice(0, -1), '0', '--comparison', '0'])).toMatchObject({ from: 0, to: 0, comparison: 0 });
    expect(parseNewspaperOptions(['--help'])).toBeUndefined();
  });

  it.each([
    [], [...required, '--unknown', 'value'], [...required, '--every'], [...required, '--every', '0'],
    [...required, '--from', '31'], [...required, '--comparison', '-1'], [...required, '--every', '1.5'],
    [...required, '--every', '9007199254740992'], [...required, '--render-turns', '31'],
    [...required, '--render-turns', '10,'], [...required, '--player', '22'],
    [...required.slice(0, 4), '--player', '22', '--to', '30'],
  ].map(args => ({ args })))('should reject invalid flags without opening resources: %j', ({ args }) => {
    expect(() => parseNewspaperOptions(args)).toThrow();
  });
});
