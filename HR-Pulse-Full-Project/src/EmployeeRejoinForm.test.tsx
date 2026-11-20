import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import EmployeeRejoinForm from './EmployeeRejoinForm';
import {api} from './api';

vi.mock('./api',async importOriginal=>({...await importOriginal<typeof import('./api')>(),api:vi.fn()}));
vi.mock('./AadhaarUploader',()=>({default:({fillDetails}:{fillDetails:(details:object)=>void})=><button type="button" onClick={()=>fillDetails({uid:'1234 5678 9012',name:'Test Employee',relationName:'Parent',dob:'1990-01-02',gender:'Male',address:'Test address'})}>Upload Aadhaar</button>}));
vi.mock('./DrivingLicenceUploader',()=>({default:({onDetails}:{onDetails:(details:object)=>void})=><button type="button" onClick={()=>onDetails({licenceNumber:'DL-01',classDetails:[{code:'HMV',vehicleCategory:'Transport'}],issueDate:'2020-01-01',validUpto:['2030-01-01']})}>Scan driving licence</button>}));

beforeEach(()=>vi.mocked(api).mockReset());

it('fetches the previous service record and offers new posting and licence fields',async()=>{
 vi.mocked(api).mockResolvedValueOnce({rows:[{id:'employee-1',kind:'employees',code:'EMP001',name:'Previous Name',status:'ACTIVE',version:2,updated_at:'',data:{site:'Dudhichua OB East',department:'Driver',designation:'Tipper Driver',officeData:{'Aadhaar No. *':'123456789012','Joining Date *':'2020-01-01','Exit Date':'2025-01-31','Reason for Exit':'Resigned'}}}]} as never);
 const {container}=render(<EmployeeRejoinForm grant="grant"/>);
 expect(container.querySelector('.employee-rejoin>header h2')).toBeNull();
 expect(container.querySelector('.employee-rejoin>header')).toBeNull();
 expect(screen.queryByText('Upload Aadhaar to fetch identity and previous employment details.')).toBeNull();
 expect(screen.getByRole('button',{name:'Upload Aadhaar'}).closest('.rejoin-section-heading')).toContainElement(screen.getByRole('heading',{name:'1. Employee details'}));
 const employeeName=screen.getByLabelText('Employee name');
 expect(employeeName).toBeRequired();
 expect(employeeName.closest('label')?.querySelector('b')).toHaveTextContent('*');
 fireEvent.click(screen.getByRole('button',{name:'Upload Aadhaar'}));
 await screen.findByText(/Duplicate Aadhaar matched previous employee EMP001 at Dudhichua OB East/);
 expect(screen.getByLabelText('Previous site')).toHaveValue('Dudhichua OB East');
 expect(screen.getByLabelText('Previous exit date')).toHaveValue('2025-01-31');
 expect(screen.getByRole('combobox',{name:/Reason for exit/})).toHaveValue('Resigned');
 fireEvent.change(screen.getByLabelText('New department'),{target:{value:'Driver'}});
 expect(screen.getByRole('option',{name:'Tipper Driver'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Scan driving licence'}));
 await waitFor(()=>expect(screen.getByLabelText('DL no. & class')).toHaveValue('DL-01 · HMV - Transport'));
 expect(screen.getByLabelText('DL valid up to')).toHaveValue('2030-01-01');
});
