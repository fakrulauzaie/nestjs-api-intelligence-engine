import { describe, expect, it } from 'vitest';
import {
  encodeCsvCell,
  neutralizeSpreadsheetFormula,
} from '../../../src/structured-exports/csv.js';

describe('Phase 22 safe CSV cells', () => {
  it('quotes RFC-sensitive text and neutralizes every spreadsheet formula marker', () => {
    for (const value of ['=cmd()', '+SUM(A1)', '-2+3', '@IMPORT']) {
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
    }
    expect(encodeCsvCell('hello, "world"\n測試')).toBe('"hello, ""world""\n測試"');
    expect(encodeCsvCell('=1+1')).toBe("'=1+1");
  });

  it('does not truncate long exported lists', () => {
    const value = Array.from({ length: 1_000 }, (_, index) => `table_${index}`).join('; ');
    expect(encodeCsvCell(value)).toContain('table_999');
    expect(encodeCsvCell(value).length).toBe(value.length);
  });
});
