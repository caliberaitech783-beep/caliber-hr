import ExcelJS, { type Borders, type Fill } from 'exceljs';

const excelType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const gridLine = { style: 'thin', color: { argb: 'FFA6A6A6' } } as const;
const borders: Partial<Borders> = { top: gridLine, bottom: gridLine, left: gridLine, right: gridLine };
const rowFill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headerFill = rowFill('FFECECEC');
const whiteFill = rowFill('FFFFFFFF');

export async function regionEmployeeExcel(
  columns: readonly { header: string; width: number }[],
  values: string[][],
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employee Master Report', {
    properties: { defaultRowHeight: 16.5 },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }],
  });
  const reportColumns = [
    { header: 'Serial No', width: 11 },
    ...columns.map(column => ({ ...column, header: column.header.toUpperCase() })),
  ];
  sheet.addTable({
    name: 'RegionEmployeeDetails',
    ref: 'A1',
    headerRow: true,
    columns: reportColumns.map(({ header }) => ({ name: header, filterButton: false })),
    rows: values.map((row, index) => [index + 1, ...row]),
    style: { theme: 'TableStyleLight1', showRowStripes: false },
  });
  reportColumns.forEach(({ width }, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).height = 18;

  sheet.eachRow((row, rowNumber) => {
    const header = rowNumber === 1;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Calibri', size: 11, bold: header, color: { argb: 'FF000000' } };
      cell.fill = header ? headerFill : whiteFill;
      cell.border = borders;
      cell.alignment = { horizontal: header ? 'center' : columnNumber === 1 ? 'right' : 'left', vertical: 'middle', wrapText: true };
    });
  });

  return new Blob([await workbook.xlsx.writeBuffer()], { type: excelType });
}
