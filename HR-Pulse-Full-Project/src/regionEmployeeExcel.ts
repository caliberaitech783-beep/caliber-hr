import ExcelJS, { type Borders, type Fill } from 'exceljs';

const excelType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const gridLine = { style: 'thin', color: { argb: 'FFB8A2CE' } } as const;
const borders: Partial<Borders> = { top: gridLine, bottom: gridLine, left: gridLine, right: gridLine };
const rowFill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headerFill = rowFill('FF522E90');
const whiteFill = rowFill('FFFFFFFF');
const stripedFill = rowFill('FFF0E6F8');

export async function regionEmployeeExcel(
  columns: readonly { header: string; width: number }[],
  values: string[][],
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Region Employee Details', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  sheet.addTable({
    name: 'RegionEmployeeDetails',
    ref: 'A1',
    headerRow: true,
    columns: columns.map(({ header }) => ({ name: header, filterButton: true })),
    rows: values,
    style: { theme: 'TableStyleLight1', showRowStripes: true },
  });
  columns.forEach(({ width }, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).height = 26;

  sheet.eachRow((row, rowNumber) => {
    const header = rowNumber === 1;
    const fill = header ? headerFill : rowNumber % 2 ? stripedFill : whiteFill;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Aptos', size: 11, bold: header || columnNumber === 1, color: { argb: header ? 'FFFFFFFF' : 'FF372B42' } };
      cell.fill = fill;
      cell.border = borders;
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    });
  });

  return new Blob([await workbook.xlsx.writeBuffer()], { type: excelType });
}
