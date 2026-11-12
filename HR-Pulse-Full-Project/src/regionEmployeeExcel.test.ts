// @vitest-environment node
import { Workbook } from 'exceljs';
import { expect, it } from 'vitest';
import { regionEmployeeExcel } from './regionEmployeeExcel';

it('writes a styled Excel report and preserves identifier and contact text', async () => {
  const columns = [
    { header: 'Employee ID', width: 18 },
    { header: 'Name', width: 27 },
    { header: 'Contact', width: 19 },
  ];
  const blob = await regionEmployeeExcel(columns, [
    ['000012', 'Sample Employee', '0012345678'],
    ['000013', '=1+1', '—'],
  ]);
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const workbook = new Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.getWorksheet('Region Employee Details')!;
  expect(sheet.getRow(1).values).toEqual([undefined, 'Employee ID', 'Name', 'Contact']);
  expect(sheet.getCell('A2').value).toBe('000012');
  expect(sheet.getCell('C2').value).toBe('0012345678');
  expect(sheet.getCell('B3').value).toBe('=1+1');
  expect(sheet.getCell('C3').value).toBe('—');
  expect(sheet.getCell('A1').font.bold).toBe(true);
  expect(sheet.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFF4EEF9' } });
  expect(sheet.getCell('B3').fill).toMatchObject({ fgColor: { argb: 'FFFAF7FC' } });
  expect(sheet.getCell('B2').border).toMatchObject({ left: { style: 'thin' }, bottom: { style: 'thin' } });
  expect(sheet.getColumn(2).width).toBe(27);
  expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  expect(sheet.autoFilter).toBe('A1:C3');
});
