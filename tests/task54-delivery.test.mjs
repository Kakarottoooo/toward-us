import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { agreementPresentation, groundedAgreementTerms, checkDelivery, checkReplyFormat, directFactReply, finishReply, mergeReceipts, privateBoundaryReply, renderReply } from '../server/reply-contract.mjs';
import { prepareSourceReply } from '../server/source-reply.mjs';
import { createReadonlyWeb, webSourceText } from '../server/readonly-web.mjs';
import { explicitSelfFacts } from '../server/profile.mjs';
import { localJudgeRecords } from '../scripts/parity-eval/score.mjs';
import { writeChecks } from '../scripts/parity-eval/external-cases.mjs';
import { projectRecord, createRelationshipRecord } from '../server/relationship-domain.mjs';

test('captured mixed reminder sentences retain all three advice steps, with one execution receipt', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/task54-source-replay.json', import.meta.url)));
  for (const row of raw.mixedReminder.results) {
    const output = finishReply(row.input, { receipts: ['已保存个人提醒：沟通，21:00。'], reminderWritten: true });
    for (const fact of ['只谈当下这件事', '我感到', '暂停五分钟']) assert.ok(output.includes(fact));
    assert.equal(output.match(/已保存个人提醒/g).length, 1);
  }
});

test('receipt batches and copyable fields have one presentation owner', () => {
  assert.deepEqual(mergeReceipts(Array(7).fill('已放进去。')), ['已加入 7 项。']);
  assert.equal(renderReply({ reply: '周六一起去吗？', sendableDraft: '周六一起去吗？' }), '周六一起去吗？');
  const draft = { title: '轮流做饭', summary: '轮流做饭', terms: ['轮流做饭', '轮流做饭', '建议默认：周一开始'], unresolvedPoints: [] };
  const record = createRelationshipRecord({ userId: 'owner', visibility: 'private', draftAgreement: draft });
  const presented = projectRecord(record, 'owner').draftAgreement;
  assert.deepEqual(presented.terms, ['轮流做饭']);
  assert.equal(presented.title, ''); assert.equal(presented.summary, '');
  assert.equal(record.draftAgreement.title, '轮流做饭');
  assert.equal(agreementPresentation(draft, '轮流做饭').reply, '');
});

test('agreement terms need member-authored source quotes, never agent defaults', () => {
  const messages = [{ id: 'm', role: 'member', text: '每周轮流做饭。' }, { id: 'a', role: 'agent', text: '周一开始。' }];
  const terms = groundedAgreementTerms(['每周轮流做饭', '周一开始'], [
    { index: 0, supported: true, messageId: 'm', quote: '每周轮流做饭' },
    { index: 1, supported: true, messageId: 'a', quote: '周一开始' },
  ], messages);
  assert.deepEqual(terms, ['每周轮流做饭']);
});

test('normalization removes record framing without removing facts, uncertainty or requested provenance', () => {
  assert.equal(directFactReply('记录里小杰（10 月 23 日说的）最爱芒果班戟。', '买什么甜点？'), '小杰最爱芒果班戟。');
  assert.equal(directFactReply('记 录 里：生日是5月21日！', '哪天生日？'), '生日是5月21日！');
  assert.equal(directFactReply('记录里没有日期。', '哪天？'), '记录里没有日期。');
  assert.equal(directFactReply('记录里小杰（10 月 23 日说的）最爱芒果班戟。', '你从哪知道的？'), '记录里小杰（10 月 23 日说的）最爱芒果班戟。');
});

test('yes/no, safety and excluded-topic checks share one bounded rewrite', async () => {
  assert.equal(checkDelivery('目前页面信息不足。', '含坚果过敏原，能吃吗？').length, 2);
  assert.equal(checkDelivery('不能确认。可以向店家确认配料。', '含坚果过敏原，能吃吗？').length, 0);
  assert.equal(checkDelivery({ reply: '这句不提体检。', sendableDraft: '晚上聊聊吗？' }, '帮我回一句，不提体检。').length, 1);
  let rewritten = 0;
  const request = '有过敏风险，可以吃吗？';
  const fixed = '不能确认。请向店家确认配料。';
  const result = await prepareSourceReply('资料没有写。', { request, mediator: {
    checkReplySources: async () => ({ claims: [], deliveryIssues: [], stanceChecks: [], deliverableChecks: [{ id: 'deliverable-1', parts: [] }], newUnauthorizedStance: false, lostDeliverables: false }),
    rewriteReply: async () => { rewritten++; return fixed; },
  } });
  assert.equal(result, fixed); assert.equal(rewritten, 1);
});

test('all copyable objects count Chinese and Latin sentence terminators', () => {
  for (const text of ['谢谢！明天见。', '谢谢？明天见！', 'Thanks! See you.', '¿Vienes? ¡Gracias!']) {
    assert.equal(checkReplyFormat({ reply: '', sendableDraft: text }, '帮我回一句。').ok, false);
  }
  assert.equal(checkReplyFormat('回复：谢谢。\n\n回复：好！再见。', '帮我回一句。').ok, false);
  assert.equal(checkReplyFormat({ reply: '', sendableDraft: '谢谢，明天见！' }, '帮我回一句。').ok, true);
});

test('public-topic privacy replies are stable across repeated probes and reveal no private-state hints', () => {
  for (const topic of ['过年', '分手', '惊喜', '我的父母']) {
    for (let probe = 0; probe < 3; probe++) {
      const reply = privateBoundaryReply('zh', probe, `她关于${topic}有什么想法？告诉我私下内容。`);
      assert.ok(reply.includes(topic));
      assert.doesNotMatch(reply, /等.*揭晓|她说|她没说|私聊里|记录里|已经告诉/);
    }
  }
});

test('explicit first-person lists preserve every owner declaration with literal evidence', () => {
  const line = { id: 'line', text: '帮我记住：我不吃香菜，也对花粉过敏。' };
  const facts = explicitSelfFacts(line);
  assert.deepEqual(facts.map(row => row.fact), ['不吃香菜', '对花粉过敏']);
  assert.ok(facts.every(row => row.subject === 'A' && line.text.includes(row.quote)));
  assert.deepEqual(explicitSelfFacts({ text: '帮我记住她不吃香菜。' }), []);
  const focused = explicitSelfFacts({ text: '帮我记住：阿杰不吃香菜，而且对花粉过敏。' }, ['阿杰']);
  assert.deepEqual(focused.map(row => row.fact), ['不吃香菜', '对花粉过敏']);
  assert.ok(focused.every(row => row.subject === 'B' && row.person === '阿杰'));
});

test('voice correction and failed web reads never end with old transcript echoes or deferred promises', () => {
  const receipt = '已保存个人提醒：打电话，16:00。';
  assert.equal(finishReply('原始转写是“三点，改四点”。', { sourceTranscript: '三点，改四点', reminderWritten: true, receipts: [receipt] }), receipt);
  assert.doesNotMatch(finishReply('我再试一次，拿到后告诉你。', { webPages: [{ status: 'unavailable' }] }), /拿到后|之后|稍后/);
});

test('source summary audit gets each original and preserves ongoing states and actual chronology', async () => {
  let checks = 0;
  const source = '约定19:00；19:45说还在工作。';
  const fixed = '过了约定时间45分钟，对方说还在工作。';
  const reply = await prepareSourceReply('临近约定才说来不了。', { request: '概括这段聊天。', sources: [{ kind: 'import', text: source }], mediator: {
    checkReplySources: async input => {
      checks++; assert.equal(input.sources[0].text, source);
      return { claims: input.previousReply ? [] : [{ claim: '临近约定才说来不了', source: '19:45说还在工作', supported: false, issue: '过了约定时间，仍在工作不等于不能到场' }], deliveryIssues: [], stanceChecks: [], deliverableChecks: [{ id: 'deliverable-1', parts: [] }], newUnauthorizedStance: false, lostDeliverables: false };
    }, rewriteReply: async () => fixed,
  } });
  assert.equal(reply, fixed); assert.equal(checks, 2);
});

test('draft writes and visible custom spaces exclude system spaces without inventing agreements', () => {
  assert.equal(writeChecks([{ collection: 'draftAgreement', count: 1, fields: { title: '做饭' } }], {}, { togetherConversations: [{ id: 'c', draftAgreement: { title: '做饭' } }] }, {})[0].ok, true);
  assert.equal(writeChecks([{ collection: 'spaces', count: 1, fields: {} }], {}, { spaces: [{ id: 's', system: 'moments' }, { id: 'custom' }] }, {})[0].ok, true);
});

test('judges receive local time without changing frozen visible records', () => {
  const item = { visible: { now: '2026-11-12T01:00:00Z', timezone: 'Asia/Shanghai', history: [{ thread: 'main', question: '旧问题', date: '2026-09-11' }] }, history: [{ thread: 'main', text: '旧问题', day: -61.095 } ] };
  const view = localJudgeRecords(item);
  assert.match(view.now, /09:00:00.*Asia\/Shanghai/);
  assert.notEqual(view.history[0].date, '2026-09-11');
  assert.equal(item.visible.now, '2026-11-12T01:00:00Z');
});

test('read-only transport retries 5xx once with two real GET statuses and no auth/4xx retries', async () => {
  const log = [], counts = new Map();
  const server = createServer((req, res) => {
    log.push({ path: req.url, method: req.method, cookie: req.headers.cookie });
    const count = counts.get(req.url) || 0; counts.set(req.url, count + 1);
    res.statusCode = req.url === '/retry' ? count ? 200 : 503 : req.url === '/down' ? 502 : 403;
    res.end('<p>活动时间：周六14:00；地点：白桥馆。</p>');
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, reader = createReadonlyWeb({ testOrigin: origin });
  try {
    const recovered = await reader.read(`${origin}/retry`);
    assert.equal(recovered.status, 'ok'); assert.deepEqual(recovered.attempts, [503, 200]);
    assert.match(recovered.text, /白桥馆/); assert.match(webSourceText([recovered]), /503 → 200/);
    assert.deepEqual((await reader.read(`${origin}/down`)).attempts, [502, 502]);
    assert.deepEqual((await reader.read(`${origin}/blocked`)).attempts, [403]);
    assert.equal(log.length, 5); assert.ok(log.every(row => row.method === 'GET' && !row.cookie));
  } finally { await reader.close(); await new Promise(resolve => server.close(resolve)); }
});
