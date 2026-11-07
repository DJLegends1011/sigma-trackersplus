// Trackers Plus in a real Sigma: it runs beside the bundled Trackers without touching it, the story's prompt
// still carries a tracker, and the Chat Assistant now reads it.
//     node --test          # SIGMA_DIR=<Project Σ checkout> when it is not ../../../../ProjectSigma-main
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.join(here, '..');
const sigmaDir = [process.env.SIGMA_DIR, path.resolve(here, '../../../../ProjectSigma-main')].filter(Boolean)
    .find(p => fs.existsSync(path.join(p, 'tools/extension-kit/index.mjs')));
const { startSigma, lintExtension } = await import(pathToFileURL(path.join(sigmaDir, 'tools/extension-kit/index.mjs')).href);

test('lint: no findings', () => {
    assert.deepEqual(lintExtension(extDir), []);
});

test('the id is one the app accepts: a "trackers-..." id falls under the bundled tables and never loads', () => {
    const { id } = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
    assert.doesNotMatch(id, /^trackers[-_]/);
});

const sigma = await startSigma({ prefix: 'trackers-plus-test', extensions: [extDir] });
after(() => sigma.close());
const me = sigma.session;
const tp = me.ext('trackersplus');
await me.enable('trackersplus');

const DEF = {
    name: 'Study Progress',
    heading: 'Study progress:',
    fields: [{ key: 'studied', label: 'Studied', kind: 'text', prompt: 'Who has been studied so far.' }],
};
const FORM = 'Felicia Hardy, 100 percent';

const persona = (await me.api('/personas', 'POST', { name: 'Demetri', description: 'A metamorph.' })).body;
await me.api('/personas/active', 'PUT', { id: persona.id });
const { id: charId } = await me.importCard({ name: 'Narrator', description: 'The narrator.', first_mes: 'The club is loud.' });
const chat = (await me.api(`/characters/${charId}/chats`, 'POST', { name: 'tp' })).body;
const chatId = chat.id;
const say = (id, messages) => me.api(`/chats/${id}/messages`, 'PUT', {
    messages: messages.map(([u, mes]) => ({ name: u ? 'Demetri' : 'Narrator', is_user: u, is_system: false, mes, send_date: new Date().toISOString() })),
});
await say(chatId, [[false, 'The club is loud.'], [true, 'I study the woman in the corner.'], [false, 'She notices.']]);

let defId;
test('a tracker is defined, bound and filled through its own routes', async () => {
    const made = await tp('/defs', 'POST', { def: DEF });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    defId = made.body.id;
    const bound = await tp(`/chats/${chatId}/trackers`, 'POST', { defId });
    assert.ok(bound.status < 300, JSON.stringify(bound.body));
    const set = await tp(`/chats/${chatId}/trackers/${defId}/state`, 'PUT', { state: { studied: FORM } });
    assert.ok(set.status < 300, JSON.stringify(set.body));
});

test('the story\'s prompt carries it, through the fork\'s own macro', async () => {
    const msgs = (await me.api(`/chats/${chatId}/prompt`)).body.messages;
    const all = msgs.map(m => m.content).join('\n');
    assert.ok(all.includes(FORM), all.slice(-400));
    assert.doesNotMatch(all, /\{\{trackers/);
});

/** A mock model: records the request, answers as a stream or a whole message. */
async function withModel(fn) {
    const seen = [];
    const upstream = http.createServer(async (req, res) => {
        let body = '';
        for await (const c of req) body += c;
        const parsed = JSON.parse(body);
        seen.push(parsed);
        if (parsed.stream) {
            res.setHeader('content-type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Noted.' } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.end('data: [DONE]\n\n');
        } else {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }] }));
        }
    });
    await new Promise(r => upstream.listen(0, '127.0.0.1', r));
    try {
        const prof = (await me.api('/llm/profiles', 'POST', { name: `mock ${Date.now()}`, kind: 'openai', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: 'k', model: 'm' })).body;
        return await fn(prof.id ?? prof.profile?.id, seen);
    } finally {
        upstream.close();
    }
}

const askAssistant = async (id, profileId) => {
    const sess = await me.api('/assistant/sessions', 'POST', { chatId: id });
    assert.equal(sess.status, 201, JSON.stringify(sess.body));
    const added = await me.api(`/assistant/sessions/${sess.body.id}/messages`, 'POST', { role: 'user', content: 'Who have I studied?' });
    assert.ok(added.status < 300, JSON.stringify(added.body));
    const resp = await me.apiRequest(`/assistant/sessions/${sess.body.id}/generate`, 'POST', { profileId });
    return resp.text();
};

test('the Chat Assistant reads the tracker: the one thing this fork is for', async () => {
    await withModel(async (profileId, seen) => {
        const text = await askAssistant(chatId, profileId);
        const call = seen.find(r => r.stream) || seen[0];
        assert.ok(call, `assistant reached the model: ${text.slice(0, 300)}`);
        assert.match(call.messages[1].content, /This chat's trackers, as of its newest message/);
        assert.ok(call.messages[1].content.includes(FORM));
    });
});

test('a chat with no tracker tells the Assistant nothing', async () => {
    const other = (await me.api(`/characters/${charId}/chats`, 'POST', { name: 'no tracker' })).body;
    await say(other.id, [[false, 'Hello.'], [true, 'Hi.']]);
    await withModel(async (profileId, seen) => {
        await askAssistant(other.id, profileId);
        assert.ok(seen.length);
        assert.doesNotMatch(seen[0].messages[1].content, /This chat's trackers/);
        assert.ok(!seen[0].messages[1].content.includes(FORM));
    });
});

test('it runs beside the bundled Trackers: separate data, and both load', async () => {
    const page = await me.page();
    try {
        await page.boot();
        assert.equal(page.host.getExtensionStatus('trackersplus')?.state, 'loaded', JSON.stringify(page.host.getExtensionStatus('trackersplus')));
        assert.ok(page.host.getChatWindows().some(w => JSON.stringify(w).includes('trackersplus') || w.id === 'trackersplus'), JSON.stringify(page.host.getChatWindows().map(w => w.id ?? w.key)));
        await new Promise(r => setTimeout(r, 300));
    } finally {
        await page.close();
    }
    await me.enable('trackers');
    const theirs = await me.ext('trackers')('/defs');
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    assert.equal((theirs.body.defs || []).length, 0, 'the fork\'s definition isn\'t in the bundled tables');
    assert.equal((await tp('/defs')).body.defs.length, 1);
    const all = (await me.api(`/chats/${chatId}/prompt`)).body.messages.map(m => m.content).join('\n');
    assert.ok(all.includes(FORM), 'the fork still answers its own macro with both on');
});
