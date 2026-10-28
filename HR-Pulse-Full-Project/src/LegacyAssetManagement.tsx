import {useState} from 'react';
import type {Module} from './api';
import {Records} from './Modules';

const tabs=[['assets','Assets'],['assetCategories','Category Master'],['assetEmployees','Employee Master'],['assetAllocationLog','Allocation Log'],['assetExitClearances','Exit Clearance']];
const columns:Record<string,string[][]>={
 assets:[['siteId','Locations'],['department','Departments'],['vendor','Vendors'],['condition','Conditions'],['assetStatus','Asset Status'],['employeeStatus','Employee Status'],['movementAction','Movement Action'],['assetGroup','Asset Group'],['depreciationMethod','Dep. Method'],['disposalMethod','Disposal Method']],
 assetCategories:[['code','Tag Prefix'],['name','Category'],['group','Group'],['extraDetails','Extra details to capture'],['activeAssets','Assets (active)']],
 assetEmployees:[['employeeId','Emp Code'],['name','Employee Name'],['department','Department'],['designation','Designation'],['siteId','Location'],['email','Work Email'],['employmentStatus','Employment Status'],['lastWorkingDay','Last Working Day'],['assetsHeld','Assets Held'],['remarks','Remarks']],
 assetAllocationLog:[['date','Date'],['assetId','Asset Tag'],['name','Asset Name'],['action','Action'],['employeeId','Emp Code'],['employeeName','Employee Name'],['fromEmployeeId','From Emp Code (transfer)'],['condition','Condition'],['vendorMethod','Vendor / Method'],['remarks','Remarks']],
 assetExitClearances:[['employeeId','Emp Code'],['name','Employee Name'],['department','Department'],['employmentStatus','Employment Status'],['lastWorkingDay','Last Working Day'],['assetsHeld','Assets Held'],['valueHeld','Value Held (₹)'],['assetTagsHeld','Asset Tags Held'],['clearance','Clearance']],
};
export default function AssetManagement({grant,config,notice}:{grant:string;config:Record<string,Module>;notice:(message:string)=>void}){
 const[tab,setTab]=useState('assets');
 return <><div className="module-tabs" aria-label="Asset management tabs">{tabs.map(([key,label])=><button key={key} className={tab===key?'selected':''} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
 {tab!=='assets'&&<p className="help-text">Asset counts, values and clearance details are entered manually. Log entries record movements without automatically changing asset assignments.</p>}
 {config[tab]?<Records key={tab} grant={grant} kind={tab} module={config[tab]} notice={notice} columns={columns[tab].map(([key,label])=>({key,label}))} actionLabel={tab==='assets'?'Add asset':'Add record'}/>:<p role="status">This asset section is unavailable for your account, or its configuration is still loading.</p>}</>;
}
