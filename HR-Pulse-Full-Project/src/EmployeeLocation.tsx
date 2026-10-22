import {useState} from 'react';
const locations={Site:['NCL','WCL'],Office:['Nagpur CO','Chandrapur HO']};
export default function EmployeeLocation({title='Employee Master'}:{title?:string}){
 const [type,setType]=useState<keyof typeof locations|''>(''),[location,setLocation]=useState('');
 return <section className="employee-master" aria-labelledby="employee-master-title"><div className="page-title"><h1 id="employee-master-title">{title}</h1></div><div className="employee-location-panel"><fieldset><legend>Site / Office</legend><div className="employee-location-types">{Object.keys(locations).map(value=><label key={value}><input type="radio" name="employee-location-type" value={value} checked={type===value} onChange={()=>{setType(value as keyof typeof locations);setLocation('')}}/>{value}</label>)}</div></fieldset>{type&&<div className="employee-location-select"><label htmlFor="employee-location">{type}</label><select id="employee-location" value={location} onChange={event=>setLocation(event.target.value)}><option value="">Select {type.toLowerCase()}</option>{locations[type].map(value=><option key={value} value={value}>{value}</option>)}</select></div>}</div></section>;
}
