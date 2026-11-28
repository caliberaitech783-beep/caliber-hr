import assert from 'node:assert/strict';
import test from 'node:test';
import {calculatePayroll,payroll} from './payroll.mjs';

const salary={basic:30000,hra:12000,fixedAllowance:3000};
test('monthly pay prorates fixed components and applies each adjustment once',()=>{
  const result=calculatePayroll(salary,{
    paidDays:15,hours:2.5,hourlyRate:123.45,allowance:200,deduction:75,
    bonus:500,incentive:100,pf:1800,esic:50,pt:200,tds:100
  },'2026-11');
  assert.deepEqual(result.earnings,{basic:15000,hra:6000,fixedAllowance:1500,allowance:200,overtime:308.63,bonus:500,incentive:100});
  assert.equal(result.gross,23608.63);
  assert.equal(result.withheld,2225);
  assert.equal(result.net,21383.63);
});
test('month length, half-days and zero paid days',()=>{
  assert.equal(calculatePayroll(salary,{},'2028-02').paidDays,29);
  assert.equal(calculatePayroll(salary,{paidDays:14.5},'2028-02').gross,22500);
  assert.equal(calculatePayroll(salary,{paidDays:0},'2028-02').gross,0);
  // A worked public holiday is paid twice: 28 days of February plus one PH worked = 29 paid days.
  assert.equal(calculatePayroll(salary,{paidDays:29},'2026-02').paidDays,29);
  for(const paidDays of [57,-1,0.25,NaN]) assert.throws(()=>calculatePayroll(salary,{paidDays},'2026-02'));
});
test('payroll rejects unauthorized menu access before reading employees',async()=>{
  await assert.rejects(payroll(null,{permissions:{hrDesktopAccess:['Employee Directory']}},'GET',new URLSearchParams(),{}),{status:403});
});

