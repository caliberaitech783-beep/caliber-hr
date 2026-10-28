import {it,expect} from 'vitest';
import {assetPrintHtml} from './assetPrint';
it('escapes imported content and uses landscape for wide reports',()=>{
 const html=assetPrintHtml('Assets',Array.from({length:10},(_,i)=>({key:String(i),label:'Column '+i})),[{'0':'<script>alert(1)</script>'}]);
 expect(html).toContain('A4 landscape');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('table-header-group');
});
