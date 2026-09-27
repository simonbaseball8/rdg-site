import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPicks } from '../app/rdg/data-audit.ts';
import { archiveGrades } from '../lib/archive-grading.ts';
import { automaticSettlement } from '../app/rdg/auto-grade.ts';
import type { Pick } from '../app/rdg/board.ts';
import type { TrackedBet } from '../app/rdg/journal.ts';
const now=Date.parse('2026-09-27T12:00Z');
const p:Pick={id:'pick',event:'game',sport:'NFL',starts:'2026-09-26T17:00Z',matchup:'A @ B',title:'A moneyline',market:'Moneyline',grading:{team:'A'},odds:110,book:'Hard Rock Bet (FL)',score:2,reasons:[],concerns:[],eligible:true};
const bet=(id:string):TrackedBet=>({id,savedAt:'2026-09-26T12:00Z',kind:'straight',mode:'model',stakeUnits:1,picks:[p],settlements:[]});
test('Audit distinguishes missing, stale, future and reference quotes without labeling them verified',()=>{
 const a=auditPicks([p,{...p,quoteAt:'2026-09-27T11:00Z'},{...p,quoteAt:'2026-09-28T12:00Z'},{...p,quoteAt:'2026-09-27T11:59Z',referencePrice:true}],now);
 assert.equal(a.missingQuotes,1);assert.equal(a.staleQuotes,2);assert.equal(a.referencePrices,1);assert.equal(a.missingWeather,4);
});
test('Archive grading shares date requests and maps overlapping slips correctly; props stay pending',async()=>{
 const b1=bet('first-bet'),b2=bet('second-bet');b2.picks=[{...p,market:'Player prop',grading:undefined}];
 let calls=0;const r=await archiveGrades([b1,b1,b2],async picks=>{calls++;return {outcomes:picks.map(()=> 'won'),warnings:[]};});
 assert.equal(calls,1);assert.deepEqual(r.outcomes,[['won'],['won'],['pending']]);
});
test('Unavailable scores retain previous automatic settlements and report the failure',async()=>{
 const b=bet('prior-bet');b.settlements=[{id:'settlement-id',at:'2026-09-26T23:00Z',outcomes:['lost'],source:'automatic',note:'Final score'}];
 const r=await archiveGrades([b],async()=>{throw Error('offline');});assert.equal(r.warnings.length,1);
 assert.equal(automaticSettlement(b,r.outcomes[0],'2026-09-27T12:00Z'),null);
});
