import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import AssetManagement from './AssetManagement';
import {api} from './api';
vi.mock('./api',async()=>({...await vi.importActual('./api'),api:vi.fn()}));
const bootstrap={role:'Admin',categories:[{id:'c',name:'Laptop',prefix:'LAP',data:{group:'IT',method:'WDV',rate:40,fields:[]}}],employees:[],locations:[],lookups:[],settings:{block_fnf:true}};
beforeEach(()=>{vi.mocked(api).mockImplementation(async(_g,path)=>path.endsWith('bootstrap')?bootstrap:[] as any);});
it('shows inventory tabs and category custom-field builder',async()=>{
 render(<AssetManagement grant="test" config={{}} notice={()=>{}}/>);
 await screen.findByText('Total assets');fireEvent.click(screen.getByRole('button',{name:'Category Master'}));
 fireEvent.click(screen.getByRole('button',{name:'+ Add category'}));
 expect(screen.getByRole('dialog')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'+ Add field'}));
 expect(screen.getByLabelText('Type')).toBeVisible();expect(screen.getByLabelText('Required')).toBeVisible();
});
it('manager sees register and cannot create assets or access settings',async()=>{
 vi.mocked(api).mockImplementation(async(_g,path)=>path.endsWith('bootstrap')?{...bootstrap,role:'Manager'}:[] as any);
 render(<AssetManagement grant="test" config={{}} notice={()=>{}}/>);await screen.findByText('Total assets');
 fireEvent.click(screen.getByRole('button',{name:'Asset Register'}));expect(screen.getByRole('button',{name:'Export Excel'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'+ Add asset'})).toBeNull();expect(screen.queryByRole('button',{name:'Settings'})).toBeNull();
});
