import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import VtcBatchModule from './VtcBatchModule';

describe('VTC Batch Module options',()=>{
 it('keeps the batch planner and opens the supplied employee VTC form',()=>{
  render(<VtcBatchModule/>);
  expect(screen.getByRole('button',{name:'VTC Batch Planner'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByTitle('VTC Batch Module')).toHaveAttribute('src','./vtc-batch-module.html');
  fireEvent.click(screen.getByRole('button',{name:'Employee VTC Form'}));
  expect(screen.getByRole('button',{name:'Employee VTC Form'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByTitle('Employee VTC Form')).toHaveAttribute('src','./employee-vtc-form.html');
 });
});
