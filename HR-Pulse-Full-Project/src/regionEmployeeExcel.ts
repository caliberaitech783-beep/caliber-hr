import { Workbook, type Borders, type Fill } from 'exceljs';

const excelType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const gridLine = { style: 'thin', color: { argb: 'FFD2C3DF' } } as const;
const borders: Partial<Borders> = { top: gridLine, bottom: gridLine, left: gridLine, right: gridLine };
const rowFill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headerFill = rowFill('FFF4EEF9');
const whiteFill = rowFill('FFFFFFFF');
const stripedFill = rowFill('FFFAF7FC');

export async function regionEmployeeExcel(
  columns: readonly { header: string; width: number }[],
  values: string[][],
) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Region Employee Details', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [...columns];
  sheet.addRows(values);
  sheet.getRow(1).height = 26;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: values.length + 1, column: columns.length },
  };

  sheet.eachRow((row, rowNumber) => {
    const header = rowNumber === 1;
    const fill = header ? headerFill : rowNumber % 2 ? stripedFill : whiteFill;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Aptos', size: 11, bold: header || columnNumber === 1, color: { argb: header ? 'FF503763' : 'FF372B42' } };
      cell.fill = fill;
      cell.border = borders;
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    });
  });

  return new Blob([await workbook.xlsx.writeBuffer()], { type: excelType });
}
