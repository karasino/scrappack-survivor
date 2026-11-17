import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, basename, sep, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sections = ['Цель и критерии готовности', 'Решения и границы', 'План', 'Контрольная точка',
    'Автоматические проверки', 'Ручная приёмка', 'Известные проблемы'];
const statuses = new Set(['draft', 'approved', 'implementing', 'awaiting-manual', 'accepted']);
const inside = (root, target) => {
    const path = relative(root, target);
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

function withoutCode(text) {
    const blank = value => value.replace(/[^\n\r]/g, ' ');
    let fence;
    const lines = text.split('\n').map(line => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
            return blank(line);
        }
        if (marker) { fence = marker[1]; return blank(line); }
        return line;
    });
    return lines.join('\n').replace(/(`+)[\s\S]*?\1/g, blank).replace(/<!--[\s\S]*?-->/g, blank);
}

function checkTask(text, label, location, errors) {
    const id = basename(label, '.md');
    const date = id.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !validDate(date)) {
        errors.push(`${label}: expected YYYY-MM-DD-short-slug.md`);
    }
    const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!header) { errors.push(`${label}: missing frontmatter`); return; }
    const metadata = {};
    for (const line of header[1].split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const field = line.match(/^([a-z]+):\s*(.*?)\s*$/);
        if (!field) { errors.push(`${label}: malformed metadata line`); continue; }
        let value = field[2];
        if (Object.hasOwn(metadata, field[1])) errors.push(`${label}: duplicate ${field[1]}`);
        if (value.startsWith('"')) {
            try { value = JSON.parse(value); } catch { errors.push(`${label}: invalid quoted ${field[1]}`); }
        } else if (value.startsWith("'")) {
            if (!value.endsWith("'")) errors.push(`${label}: invalid quoted ${field[1]}`);
            value = value.slice(1, -1).replace(/''/g, "'");
        } else if (/^[\[\]{|>&*!]/.test(value)) errors.push(`${label}: ${field[1]} must be a scalar string`);
        metadata[field[1]] = value;
    }
    for (const key of ['id', 'title', 'status', 'updated']) {
        if (typeof metadata[key] !== 'string' || !metadata[key].trim()) errors.push(`${label}: missing ${key}`);
    }
    if (metadata.id !== id) errors.push(`${label}: id must match filename`);
    if (!validDate(metadata.updated ?? '')) errors.push(`${label}: updated must be a valid date`);
    if (!statuses.has(metadata.status)) errors.push(`${label}: unknown status`);
    if ((location === 'done') !== (metadata.status === 'accepted')) errors.push(`${label}: status does not match ${location} placement`);
    const body = text.slice(header[0].length);
    const headings = [...withoutCode(body).matchAll(/^## (.+)\r?$/gm)];
    for (const section of sections) {
        const matches = headings.filter(match => match[1] === section);
        if (matches.length !== 1) { errors.push(`${label}: expected section "${section}" once`); continue; }
        const heading = matches[0];
        const next = headings.find(candidate => candidate.index > heading.index);
        if (!body.slice(heading.index + heading[0].length, next?.index ?? body.length).replace(/<!--[\s\S]*?-->/g, '').trim()) {
            errors.push(`${label}: section "${section}" is empty`);
        }
    }
}

export async function checkDocuments(directory) {
    const root = await realpath(directory);
    const errors = [];
    const documents = new Map();
    async function read(path, required = false) {
        if (documents.has(path)) return documents.get(path);
        try {
            const text = await readFile(join(root, path), 'utf8');
            documents.set(path, text);
            return text;
        } catch (error) {
            if (required || error.code !== 'ENOENT') errors.push(`${path}: cannot read (${error.code})`);
        }
    }
    async function collect(path) {
        let entries;
        try { entries = await readdir(join(root, path), { withFileTypes: true }); }
        catch (error) { if (error.code !== 'ENOENT') errors.push(`${path}: cannot list (${error.code})`); return; }
        for (const entry of entries) {
            const child = `${path}/${entry.name}`;
            if (entry.isDirectory()) await collect(child);
            else if (entry.isFile() && entry.name.endsWith('.md')) await read(child);
        }
    }
    for (const path of ['AGENTS.md', 'README.md', 'docs/status.md', 'docs/tasks/README.md', 'docs/tasks/_template.md', '.agents/skills/scrappack-task/SKILL.md']) await read(path, true);
    await collect('docs');
    await collect('.agents/skills');
    await read('public/assets/items/README.md');
    for (const [path, limit] of [['AGENTS.md', 8192], ['docs/status.md', 4096]]) {
        if (documents.has(path) && Buffer.byteLength(documents.get(path)) > limit) errors.push(`${path}: exceeds ${limit} bytes`);
    }
    const active = [];
    for (const location of ['active', 'done']) {
        const path = `docs/tasks/${location}`;
        try {
            for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
                if (entry.isDirectory()) errors.push(`${path}/${entry.name}: nested task directories unsupported`);
                if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
                const name = `${path}/${entry.name}`;
                if (location === 'active') active.push(name);
                const text = await read(name, true);
                if (text !== undefined) checkTask(text, name, location, errors);
            }
        } catch (error) { errors.push(`${path}: cannot list (${error.code})`); }
    }
    if (active.length > 1) errors.push('Expected at most one active task');
    const markers = [...(documents.get('docs/status.md') ?? '').matchAll(/<!--\s*active-task:\s*(.*?)\s*-->/g)];
    if (markers.length !== 1 || markers[0][1] !== (active.length === 1 ? active[0] : 'none')) errors.push('docs/status.md: active-task pointer does not match active tasks');
    for (const [path, text] of documents) {
        if (path.startsWith('docs/tasks/') && !['docs/tasks/README.md', 'docs/tasks/_template.md'].includes(path) &&
            !/^docs\/tasks\/(active|done)\/[^/]+\.md$/.test(path)) errors.push(`${path}: task must be in active or done`);
        if (path === 'docs/archive/legacy-spec.md') continue;
        const content = withoutCode(text);
        const destinations = [...content.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s()]+(?:\([^()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\s*\)/g)].map(match => match[1]);
        destinations.push(...[...content.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)].map(match => match[1]));
        for (let target of new Set(destinations)) {
            if (target.startsWith('<')) target = target.slice(1, -1);
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
            target = target.split(/[?#]/)[0];
            if (!target) continue;
            try {
                target = decodeURIComponent(target);
                const destination = resolve(root, dirname(path), target);
                if (!inside(root, destination) || !inside(root, await realpath(destination))) throw new Error('outside repository');
            } catch (error) { errors.push(`${path}: broken local link "${target}" (${error.code ?? error.message})`); }
        }
    }
    return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const errors = await checkDocuments(process.argv[2] ?? process.cwd());
        if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exitCode = 1; }
        else console.log('Documentation checks passed.');
    } catch (error) { console.error(`Documentation checks failed (${error.code ?? error.message}).`); process.exitCode = 1; }
}
