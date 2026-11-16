import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureValue, writeChecks } from '../scripts/parity-eval/external-cases.mjs';
import { citedReply } from '../server/conversation-recall.mjs';
import { prepareSourceReply } from '../server/source-reply.mjs';

test('calendar offsets use the case timezone, including DST and month boundaries', () => {
  assert.equal(fixtureValue('{date:3}', { at: Date.parse('2026-11-11T23:06:51Z'), timezone: 'Asia/Shanghai' }), '2026-11-15');
  assert.equal(fixtureValue('{date:1}', { at: Date.parse('2026-03-08T07:30:00Z'), timezone: 'America/Los_Angeles' }), '2026-03-08');
  assert.equal(fixtureValue('{date:-1}', { at: Date.parse('2026-03-01T00:30:00Z'), timezone: 'UTC' }), '2026-02-28');
  const specs = [{ collection: 'reminders', count: 1, fields: { timezone: 'Asia/Shanghai', dueAt: '{date:3}T12:00:00.000Z' } }];
  assert.equal(writeChecks(specs, {}, { reminders: [{ id: 'new', timezone: 'Asia/Shanghai', dueAt: '2026-11-15T12:00:00.000Z' }] }, { at: Date.parse('2026-11-11T23:06:51Z') })[0].ok, true);
});

test('selected recall renders the question, original answer and date; unknown IDs cannot render', () => {
  const sources = [{ messageId: 'known', date: '2026-04-12', channel: 'me', conversationId: 'private', exchange: { question: 'How do I ask for time?', answer: 'Ask for a quiet hour.', answerDate: '2026-04-12' } }];
  const answer = citedReply('Just take an hour. [recall:known]', sources, { renderExchanges: true, language: 'en' });
  assert.match(answer.reply, /How do I ask for time/);
  assert.match(answer.reply, /Ask for a quiet hour/);
  assert.match(answer.reply, /2026-04-12/);
  assert.equal(answer.sources[0].exchange, undefined);
  assert.equal(citedReply('No match [recall:unknown]', sources, { renderExchanges: true }).reply, 'No match');
});

test('every requested clause requires itemized coverage with quotes from the actual candidate', async () => {
  const request = '只回答改到哪天几点。';
  let checks = 0;
  const answer = await prepareSourceReply('下午两点。', { request, sources: [{ text: '改到下周二下午两点。' }], mediator: {
    async checkReplySources(input) {
      checks++;
      assert.equal(input.requestedDeliverables.items[0].clause, request);
      return { claims: [], deliveryIssues: [], stanceChecks: [], newUnauthorizedStance: false, lostDeliverables: false,
        deliverableChecks: [{ id: 'deliverable-1', parts: [
          { requirement: '日期', present: Boolean(input.previousReply), quote: input.previousReply ? '下周二' : '' },
          { requirement: '时刻', present: true, quote: '下午两点' },
        ] }] };
    }, async rewriteReply() { return '下周二下午两点。'; },
  } });
  assert.equal(answer, '下周二下午两点。');
  assert.equal(checks, 2);
});
