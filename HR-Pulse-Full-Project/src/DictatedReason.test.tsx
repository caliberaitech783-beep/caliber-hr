import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import DictatedReason from './DictatedReason';
afterEach(()=>vi.unstubAllGlobals());
it('appends spoken words to the reason and releases the microphone on close',()=>{
 let instance:any;class Recognition{start=vi.fn();stop=vi.fn();abort=vi.fn();onresult:any;onend:any;onerror:any;constructor(){instance=this;}}
 vi.stubGlobal('SpeechRecognition',Recognition);const change=vi.fn();const view=render(<DictatedReason value="Existing reason" disabled={false} change={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'Speak reason'}));expect(instance.start).toHaveBeenCalled();
 instance.onresult({results:[{isFinal:true,0:{transcript:'medical appointment'}}]});expect(change).toHaveBeenCalledWith('Existing reason medical appointment');
 view.unmount();expect(instance.abort).toHaveBeenCalled();expect(instance.onresult).toBeNull();
});
