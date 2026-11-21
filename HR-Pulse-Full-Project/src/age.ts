// Calendar age as of today's date in India. Month-end anniversaries clamp to that month's last day.
const indiaDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
export function todayInIndia(){
 const parts=Object.fromEntries(indiaDateFormatter.formatToParts(new Date()).map(({type,value})=>[type,value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
function date(value:string){const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})$/),local=value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);const parts=iso?[+iso[1],+iso[2],+iso[3]]:local?[+local[3],+local[2],+local[1]]:null;if(!parts)return null;const [y,m,d]=parts,stamp=Date.UTC(y,m-1,d),parsed=new Date(stamp);return y>=1000&&parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d?parsed:null;}
function anniversary(birth:Date,months:number){const month=birth.getUTCMonth()+months,first=new Date(Date.UTC(birth.getUTCFullYear(),month,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(birth.getUTCDate(),last)));}
export function calendarAge(value:string,asOf=todayInIndia()){
 const birth=date(value),today=date(asOf);if(!birth||!today||birth>today)return null;
 let months=(today.getUTCFullYear()-birth.getUTCFullYear())*12+today.getUTCMonth()-birth.getUTCMonth();if(anniversary(birth,months)>today)months--;
 return {years:Math.floor(months/12),months:months%12,days:Math.round((today.getTime()-anniversary(birth,months).getTime())/86400000)};
}
export function ageText(value:string,asOf=todayInIndia()){const age=calendarAge(value,asOf);return age?Object.entries(age).map(([unit,count])=>`${count} ${count===1?unit.slice(0,-1):unit}`).join(', '):'';}
/* Owner, 21 Nov 2026: an employee's own Date of Birth must make them at least 18 years old as of today's date (India). */
export const MINIMUM_EMPLOYEE_AGE=18;
export function latestBirthDate(minYears:number,asOf=todayInIndia()){const [y,m,d]=asOf.split('-').map(Number),last=new Date(Date.UTC(y-minYears,m,0)).getUTCDate();return `${String(y-minYears).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;}
export function minimumAgeMessage(value:string,minYears=MINIMUM_EMPLOYEE_AGE,asOf=todayInIndia()){
 if(!calendarAge(value,'9999-12-31'))return ''; // empty or not a real date: the DD/MM/YYYY check reports that
 const age=calendarAge(value,asOf);
 if(age&&age.years>=minYears)return '';
 const latest=latestBirthDate(minYears,asOf).split('-').reverse().join('/');
 return age?`Age must be at least ${minYears} years as of today (born on or before ${latest}).`:`Date of Birth cannot be after today. Age must be at least ${minYears} years (born on or before ${latest}).`;
}
