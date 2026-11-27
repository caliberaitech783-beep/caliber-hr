// One employee number, one person (owner, 23 Nov 2026).
//
// HR Pulse is the only place where an employee is created, and Pulse-II books every trip card, attendance day and
// salary line by this number. Until this rule a new joiner's number was counted from the joining forms alone, so it
// landed on numbers the Employee Master register already gave to working drivers. From now on:
//  - a new joiner's number is the first free number above NUMBER_FLOOR and above every number HR Pulse has itself
//    issued since; a number the register, a joining form or a reservation holds is never given again
//    (CMPL123 = CMLL123 = 123);
//  - a joining form cannot be saved under a number that belongs to another person;
//  - a register line cannot be given an ID that is not a number, or a number another line holds;
//  - an Excel import does not add a second line for a number the register already holds.
const text=value=>value===null||value===undefined?'':String(value).trim();

// The number of an Employee ID: CMPL123, CMLL123, "CMLL 123" and 123 are one person. '' when it is not a number.
export const employeeNumber=value=>{
 const match=text(value).toUpperCase().replace(/[\s/-]/g,'').match(/^(?:CMPL|CMLL)?(\d{1,9})$/);
 return match&&Number(match[1])>0?String(Number(match[1])):'';
};
// An ID as it may be typed on a register line: empty, or CMLL / CMPL / nothing followed by digits only (a space or
// a hyphen after the letters is accepted, as in "CMLL-04"). "CMLL6665/1" is refused: every reader takes it for 66651.
export const typedIdProblem=value=>{
 const id=text(value);
 if(!id)return '';
 return /^(?:CMPL|CMLL)?[\s-]?\d{1,9}$/i.test(id)&&employeeNumber(id)?'':'Employee ID must be CMLL followed by digits only, for example CMLL12345.';
};

// On 23 Nov 2026 the old numbering had reached 21955 in the Employee Master register and 22356 in Pulse-II
// (people the old ERP added who are not in HR's list). HR Pulse issues numbers above this floor, with some room
// left for a number the old ERP may still have given. A stray higher number that already exists is skipped
// when reached.
export const NUMBER_FLOOR=22500;
export const OUR_PREFIXES=Object.freeze(['CMLL','CMPL']);

// The next number for a new joiner. `held`: every number anyone holds (register, joining forms, reservations).
// `issued`: the numbers HR Pulse itself gave (joining forms and reservations).
// Numbers stay five digits (owner, 27 Nov 2026: the series runs 22501, 22502 …). A joining form or reservation saved
// with a longer number (CMLL123456816 was typed by mistake and every new code became CMLL123456817) never moves the
// count: an issued number above NUMBER_CEILING is ignored.
export const NUMBER_CEILING=99999;
export const inSeries=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>NUMBER_FLOOR&&n<=NUMBER_CEILING;};
export function nextEmployeeNumber(held,issued=[],floor=NUMBER_FLOOR){
 const taken=new Set([...held].map(Number).filter(n=>Number.isSafeInteger(n)&&n>0));
 let next=floor;
 for(const value of issued){const n=Number(value);if(Number.isSafeInteger(n)&&n>next&&n<=NUMBER_CEILING)next=n;}
 do next++;while(taken.has(next));
 return next;
}

// Two names of one person: the same words, or the same first name with at least one more word in common
// (a short form such as "DADULAL" for "DADULAL YADAV" also counts). Anything else is treated as two people.
const words=name=>text(name).toUpperCase().split(/[^A-Z]+/).filter(Boolean);
export function samePerson(a,b){
 const one=words(a),two=words(b);
 if(!one.length||!two.length)return false;
 if(one.join(' ')===two.join(' '))return true;
 if(one[0]!==two[0]||one[0].length<3)return false;
 if(one.length===1||two.length===1)return true;
 return one.slice(1).some(word=>word.length>=3&&two.slice(1).includes(word));
}

// Postgres pattern for "this ID is number N", the same reading as employeeNumber.
const idIs=number=>`^(CMPL|CMLL)?0*${number}$`;
const CLEAN="regexp_replace(upper(COALESCE(%s,'')),'[[:space:]/-]','','g')";
const clean=column=>CLEAN.replace('%s',column);

// registerFilter: the SQL that keeps the register's real entries (isEmployeeEntry in employee-master-register.mjs).
export const heldNumbersSql=registerFilter=>`SELECT data->>'employeeId' AS id,'register' AS source FROM hr_employee_master_register WHERE ${registerFilter}
 UNION ALL SELECT code AS id,kind AS source FROM hr_records WHERE kind IN ('employees','employeeCodes')`;
export async function heldNumbers(db,registerFilter){
 const held=new Set(),issued=new Set();
 for(const row of (await db.query(heldNumbersSql(registerFilter))).rows||[]){
  const number=employeeNumber(row.id);if(!number)continue;
  held.add(Number(number));if(row.source!=='register')issued.add(Number(number));
 }
 return {held,issued};
}

// Who holds a number today: register lines and joining forms (a rejected or cancelled form holds nothing).
export async function numberHolders(db,number,{registerFilter,exceptRecordId='',exceptRegisterId=''}={}){
 if(!employeeNumber(number))return [];
 const pattern=idIs(employeeNumber(number));
 const register=(await db.query(`SELECT id::text AS id,name,site_name AS site,data->>'employeeId' AS code FROM hr_employee_master_register
  WHERE ${registerFilter} AND ${clean("data->>'employeeId'")} ~ $1 AND id::text<>$2`,[pattern,String(exceptRegisterId||'')])).rows||[];
 const forms=(await db.query(`SELECT r.id::text AS id,r.name,r.code,(SELECT s.name FROM hr_records s WHERE s.kind='sites' AND s.id::text=r.data->>'siteId') AS site
  FROM hr_records r WHERE r.kind='employees' AND r.status NOT IN ('REJECTED','CANCELLED') AND ${clean('r.code')} ~ $1 AND r.id::text<>$2`,[pattern,String(exceptRecordId||'')])).rows||[];
 return [...register.map(row=>({...row,where:'Employee Master'})),...forms.map(row=>({...row,where:'a joining form'}))];
}
export const holderLine=holder=>`${text(holder.name)||'another person'}${holder.site?' ('+holder.site+')':''} in ${holder.where}`;

// For a joining form: the number may be the person's own (rejoining, or a form for someone already in the
// register), never somebody else's.
export async function otherPersonWithNumber(db,{code,name,registerFilter,exceptRecordId}){
 const number=employeeNumber(code);
 if(!number)return null;
 return (await numberHolders(db,number,{registerFilter,exceptRecordId})).find(holder=>!samePerson(holder.name,name))||null;
}
