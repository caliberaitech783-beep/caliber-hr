// Reads the sites' hour-wise Excel for the Working Hours update (working-hours-import.mjs). Used by the browser, so
// it imports nothing of the server. The workbook has one sheet per site and every site lays its sheet out
// differently, so the columns are found by what is in them, not by their headings: the Employee ID column is the
// one full of CMPL / CMLL numbers, the hours column the one full of "8 hrs" / "12 HRS" / "8 Hrs Day & Night".
// Only the Employee ID, the name and the hours are read; nothing else of the sheet leaves the browser.
import {sheetWorkingHours} from './working-hours.mjs';

const text = value => value === null || value === undefined ? '' : String(value).trim();
const idCell = value => /^(?:CMPL|CMLL)\s*-?\s*\d{1,7}$/i.test(text(value));
const nameHeading = value => /^(?:employee'?s?\s+name|name\s+of\s+employees?|employee\s+name|full\s+name|name)$/i.test(text(value));

// sheets: [{name, rows: unknown[][]}] as read from the workbook, headings in the first row.
export function readWorkingHoursSheets(sheets) {
  const entries = [], problems = [], summary = [];
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    const name = text(sheet?.name), rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    const body = rows.slice(1).map((row,index)=>({row:index+2,cells:Array.isArray(row)?row:[]})).filter(({cells})=>cells.some(cell=>text(cell)));
    const width = rows.reduce((max,row)=>Math.max(max,Array.isArray(row)?row.length:0),0);
    const count = test => Array.from({length:width},(_,column)=>body.filter(({cells})=>test(cells[column])).length);
    const best = counts => counts.reduce((top,value,column)=>value>counts[top]?column:top,0);
    const ids = count(idCell), hours = count(value=>Boolean(sheetWorkingHours(value))&&!/^\d+(\.\d+)?$/.test(text(value)));
    const idColumn = best(ids), hoursColumn = best(hours);
    const heading = column => text(rows[0]?.[column]);
    if (!body.length || !width || ids[idColumn]*2 < body.length || hours[hoursColumn]*2 < body.length) {
      summary.push({sheet:name,rows:body.length,read:0,note:'No Employee ID column and hours column were found on this sheet. It was left out.'});
      continue;
    }
    const nameColumn = (Array.isArray(rows[0])?rows[0]:[]).findIndex(nameHeading);
    let read = 0;
    for (const {row,cells} of body) {
      const employeeId = text(cells[idColumn]).toUpperCase().replace(/[\s-]+/g,''), raw = text(cells[hoursColumn]);
      const person = nameColumn>=0 ? text(cells[nameColumn]) : '';
      if (!idCell(cells[idColumn])) { problems.push({sheet:name,row,employeeId:text(cells[idColumn]),name:person,hours:raw,reason:'No Employee ID on this row'}); continue; }
      const value = sheetWorkingHours(raw);
      if (!value) { problems.push({sheet:name,row,employeeId,name:person,hours:raw,reason:raw?'Hours not understood (8, 9, 10, 11 or 12 hours)':'No hours on this row'}); continue; }
      entries.push({sheet:name,row,employeeId,name:person,hours:value});
      read++;
    }
    summary.push({sheet:name,rows:body.length,read,idColumn:heading(idColumn),hoursColumn:heading(hoursColumn)});
  }
  return {entries,problems,sheets:summary};
}
