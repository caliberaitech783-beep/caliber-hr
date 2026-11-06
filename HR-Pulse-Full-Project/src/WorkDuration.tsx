import {ageText} from './age';
import './birth-date.css';
export default function WorkDuration({from,to,label='Work Duration'}:{from:string;to:string;label?:string}){
 const duration=from&&to?ageText(from,to):'';
 return <span className="birth-age work-duration" aria-label={label} aria-live="polite" title="Calculated from From Date to To Date">{duration||(from&&to?'Check date range':'—')}</span>;
}
