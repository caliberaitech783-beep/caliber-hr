// Calendar age as of today's date in India. Month-end anniversaries clamp to that month's last day.
export function todayInIndia(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function date(value:string){const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})$/),local=value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);const parts=iso?[+iso[1],+iso[2],+iso[3]]:local?[+local[3],+local[2],+local[1]]:null;if(!parts)return null;const [y,m,d]=parts,stamp=Date.UTC(y,m-1,d),parsed=new Date(stamp);return y>=1000&&parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d?parsed:null;}
function anniversary(birth:Date,months:number){const month=birth.getUTCMonth()+months,first=new Date(Date.UTC(birth.getUTCFullYear(),month,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(birth.getUTCDate(),last)));}
export function calendarAge(value:string,asOf=todayInIndia()){
 const birth=date(value),today=date(asOf);if(!birth||!today||birth>today)return null;
 let months=(today.getUTCFullYear()-birth.getUTCFullYear())*12+today.getUTCMonth()-birth.getUTCMonth();if(anniversary(birth,months)>today)months--;
 return {years:Math.floor(months/12),months:months%12,days:Math.round((today.getTime()-anniversary(birth,months).getTime())/86400000)};
}
export function ageText(value:string,asOf=todayInIndia()){const age=calendarAge(value,asOf);return age?Object.entries(age).map(([unit,count])=>`${count} ${count===1?unit.slice(0,-1):unit}`).join(', '):'';}
