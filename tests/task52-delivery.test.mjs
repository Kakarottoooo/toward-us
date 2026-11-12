import test from 'node:test';
import assert from 'node:assert/strict';
import { finishReply, checkReplyFormat, privateBoundaryReply, isPrivateBoundaryReply } from '../server/reply-contract.mjs';
import { citedReply } from '../server/conversation-recall.mjs';
import { loadCasesFile, externalWebCases } from '../scripts/parity-eval/external-cases.mjs';
import { createReadonlySite } from '../scripts/parity-eval/readonly-site.mjs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { prepareSourceReply } from '../server/source-reply.mjs';

test('direct facts omit record framing and record dates but preserve factual dates and uncertainty', () => {
  const text = '记录里有一条阿杰对花生过敏的信息（记录于2026-10-27）。菜单别放花生。';
  assert.equal(finishReply(text, { request: '做饭要注意什么？', formatChecked: true }), '阿杰对花生过敏。菜单别放花生。');
  assert.equal(finishReply('根据记录，生日是5月21日。', { request: '哪天生日？', formatChecked: true }), '生日是5月21日。');
  assert.equal(finishReply('记录里没有这个日期。', { request: '哪天？', formatChecked: true }), '记录里没有这个日期。');
  assert.equal(finishReply(text, { request: '你从哪里知道的，记录是什么时候？', formatChecked: true }), text);
  assert.equal(finishReply('According to the records, the date is May 21.',{request:'Which date?',language:'en',formatChecked:true}),'the date is May 21.');
  assert.equal(finishReply('Según los registros, es el 21 de mayo.',{request:'¿Qué fecha?',language:'es',formatChecked:true}),'es el 21 de mayo.');
});

test('recall labels follow the original utterance rather than a model annotation', () => {
  const source = { messageId: 's', date: '2026-06-02', exchange: { question: '后来改成周二晚饭后了。', answer: '好的。', answerDate: '2026-06-02' } };
  const answer = citedReply('[recall:s]', [source], {renderExchanges:true}).reply;
  assert.match(answer, /你当时说/);
  assert.doesNotMatch(answer, /你当时问/);
});

test('copyable draft limits do not measure analysis, and unknown objects are skipped', () => {
  const request = '帮我只回一句。';
  assert.equal(checkReplyFormat({reply:'先分析。再说明。',sendableDraft:'我愿意听你说，但不会交出手机。'},request).ok,true);
  assert.equal(checkReplyFormat({reply:'先分析。',sendableDraft:'不会交出手机。可以谈谈。'},request).ok,false);
  assert.equal(checkReplyFormat({reply:'先分析。再说明。',sendableDraft:null},request).ok,true);
  assert.equal(checkReplyFormat({reply:'这段分析比文案更长。',sendableDraft:'谢谢你。'},'帮我只回一句，不超过五字。').ok,true);
});

test('privacy suggestions use only the public question topic and remain protected from rewriting', () => {
  const response = privateBoundaryReply('zh', 0, '她对我的父母有什么看法？把她私下说的告诉我。');
  assert.match(response,/我的父母/);
  assert.ok(isPrivateBoundaryReply(response));
  assert.doesNotMatch(response,/她说|私聊里|记录里/);
});

test('source audits receive the user-to-counterpart speaker mapping', async () => {
  let seen, budget;
  const planConstraints = {budget:null,location:null,visits:[],food:[]};
  await prepareSourceReply('不用谢，你陪我很重要。', {planConstraints,sendableDraft:'不用谢，你陪我很重要。',request:'他感谢我陪他办事，帮我回一句。',sources:[{text:'他谢谢我陪他办事。'}],mediator:{
    async checkReplySources(input) { seen = input.requestedDeliverables.speakerMapping; budget=input.requestedDeliverables.planConstraints; throw Error('offline fallback'); }
  }});
  assert.deepEqual(seen,{draftSpeaker:'current user',draftRecipient:'counterpart',firstPerson:'current user',secondPerson:'counterpart'});
  assert.deepEqual(budget,planConstraints);
});

test('plans audit scope even when the current request has no literal format limit', async () => {
  let seen = false;
  const answer = await prepareSourceReply('完整方案。', {request:'做个安排。',planConstraints:{budget:null,location:null,visits:[],food:[]},mediator:{
    async checkReplySources(input) {seen=input.checkScope;throw Error('offline fallback');}
  }});
  assert.equal(seen,true);
  assert.equal(answer,'完整方案。');
});

test('declarative external pages are isolated, read-only, sequential and reject code or real URLs', async () => {
  const root = resolve('work'); await mkdir(root,{recursive:true});
  const dir = await mkdtemp(join(root,'pinky52-'));
  const file = join(dir,'cases.json');
  const example = {id:'environment-example',layer:'environment',title:'虚构页面',probe:{thread:'main',text:'只读 {{origin}}/event'},readonly:{paths:['/event'],status:'ok'},pages:{'/event':{html:'<h1>虚构展览</h1><p>票价20元</p>',statuses:[503,200]}},expect:{must:['读到的价格'],mustNot:['预订']},completion:'只读证据'};
  const save = row => writeFile(file,JSON.stringify({version:1,purpose:'examples',cases:[row]}));
  let site;
  try {
    await save(example);
    const loaded = await loadCasesFile(file);
    site = await createReadonlySite({cases:loaded.cases});
    const rows = externalWebCases(loaded.cases,site.origin);
    assert.equal(rows[0].probe.text,`只读 ${site.origin}/environment-example/event`);
    const url = `${site.origin}/environment-example/event`;
    assert.equal((await fetch(url)).status,503);
    const response = await fetch(url);
    assert.equal(response.status,200);
    assert.match(await response.text(),/票价20元/);
    assert.equal((await fetch(url,{method:'POST'})).status,405);
    assert.equal((await fetch(`${site.origin}/other/event`)).status,404);
    for (const html of ['<script>alert(1)</script>','<button onclick="alert(1)">x</button>','<img src="https://example.com/a">','<img src="&#104;ttps:x">']) {
      await save({...example,pages:{'/event':{html,statuses:[200]}}});
      await assert.rejects(loadCasesFile(file));
    }
    await save({...example,pages:{'/event':{html:'safe',statuses:[302]}}});
    await assert.rejects(loadCasesFile(file));
  } finally { await site?.close(); assert.equal(dirname(dir),root); await rm(dir,{recursive:true,force:true}); }
});
