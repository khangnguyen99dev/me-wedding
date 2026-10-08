/**
 * Discover templates in ./templates/{key}, build their manifests and register
 * them in the `templates` table.
 *
 *   npm run templates:sync              -> writes supabase/templates.sql (paste into the SQL editor)
 *   npm run templates:sync -- --push    -> upserts directly (needs SUPABASE_SERVICE_ROLE_KEY)
 *   add --prune                         -> disable templates whose folder is gone
 *
 * Each template folder: template.json, preview.json, index.html, assets/{images,fonts,js,media}.
 * index.html references its assets as /templates/{key}/..., which the Node server
 * maps to templates/{key}/assets/... (or a CDN via ASSET_BASE_URL).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SectionDef, TemplateManifest } from '../shared/types';

try {
    process.loadEnvFile?.();
} catch {
    /* no .env — rely on the real environment */
}

const ROOT = resolve(import.meta.dirname, '..');
const TEMPLATES = join(ROOT, 'templates');
const args = new Set(process.argv.slice(2));

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
    }
}

/**
 * Synthetic "custom_images" section: one image field per unique image the
 * template HTML references, so the couple can swap any picture. Field keys
 * match the Laravel version (img_ + md5(path)[0..12]) so existing data maps 1:1.
 */
function imageSection(key: string): SectionDef | null {
    const html = readFileSync(join(TEMPLATES, key, 'index.html'), 'utf8');
    const re = new RegExp(`templates/${key}/images/[^"'\\s)]+?\\.(?:png|jpe?g|gif|webp)`, 'gi');

    const fields: NonNullable<SectionDef['fields']> = {};
    for (const ref of new Set(html.match(re) ?? [])) {
        const rel = ref.replace(/^\/+/, '');
        fields['img_' + createHash('md5').update(rel).digest('hex').slice(0, 12)] = {
            type: 'image',
            label: rel.split('/').pop(),
            original: '/' + rel,
            match: rel,
        };
    }

    return Object.keys(fields).length ? { label: 'Ảnh trong mẫu', ui: 'image_grid', fields } : null;
}

/** Drop @image:/@audio: placeholders whose file is missing, so creation never breaks. */
function checkPreview(key: string, value: any, missing: string[]): any {
    if (Array.isArray(value)) return value.map((v) => checkPreview(key, v, missing)).filter((v) => v !== undefined);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, checkPreview(key, v, missing)]));
    }
    if (typeof value === 'string' && /^@(image|audio):/.test(value)) {
        const [kind, file] = [value.slice(1, 6), value.slice(7)];
        const path = join(TEMPLATES, key, 'assets', kind === 'image' ? 'images' : 'media', file);
        if (!existsSync(path)) {
            missing.push(value);
            return undefined;
        }
    }
    return value;
}

interface Row {
    key: string;
    name: string;
    version: string;
    description: string | null;
    thumbnail: string | null;
    status: 'active';
    manifest: TemplateManifest;
    preview: Record<string, any>;
    synced_at: string;
}

function scan(): Row[] {
    const rows: Row[] = [];

    for (const key of readdirSync(TEMPLATES).sort()) {
        const dir = join(TEMPLATES, key);
        if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'template.json'))) continue;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
            console.warn(`! skipped "${key}": folder name must be lowercase a-z, 0-9, -`);
            continue;
        }
        if (!existsSync(join(dir, 'index.html'))) {
            console.warn(`! skipped "${key}": missing index.html`);
            continue;
        }

        const m = readJson(join(dir, 'template.json'));
        const manifest: TemplateManifest = {
            ...m,
            key,
            name: m.name ?? key[0].toUpperCase() + key.slice(1),
            version: m.version ?? '1.0.0',
            sections: m.sections ?? {},
            theme: m.theme ?? {},
        };

        if ((manifest.engine ?? 'ladipage') === 'ladipage') {
            const section = imageSection(key);
            if (section) manifest.sections = { ...manifest.sections, custom_images: section };
        }

        const missing: string[] = [];
        const preview = existsSync(join(dir, 'preview.json'))
            ? checkPreview(key, readJson(join(dir, 'preview.json')), missing)
            : {};
        if (missing.length) console.warn(`! ${key}: preview references missing files: ${missing.join(', ')}`);

        rows.push({
            key,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? null,
            thumbnail: manifest.thumbnail ? `/templates/${key}/${manifest.thumbnail}` : null,
            status: 'active',
            manifest,
            preview,
            synced_at: new Date().toISOString(),
        });
    }

    return rows;
}

function dollarQuote(text: string): string {
    let tag = 'tpl';
    while (text.includes(`$${tag}$`)) tag += 'x';
    return `$${tag}$${text}$${tag}$`;
}

function toSql(rows: Row[], prune: boolean): string {
    const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
    const values = rows
        .map((r) =>
            `  (${lit(r.key)}, ${lit(r.name)}, ${lit(r.version)}, ${lit(r.description)}, ${lit(r.thumbnail)}, 'active',\n` +
            `   ${dollarQuote(JSON.stringify(r.manifest))}::json,\n` +
            `   ${dollarQuote(JSON.stringify(r.preview))}::json, now())`,
        )
        .join(',\n');

    let sql =
        `-- Generated by \`npm run templates:sync\` on ${new Date().toISOString()}\n` +
        `insert into public.templates (key, name, version, description, thumbnail, status, manifest, preview, synced_at)\nvalues\n${values}\n` +
        `on conflict (key) do update set\n` +
        `  name = excluded.name, version = excluded.version, description = excluded.description,\n` +
        `  thumbnail = excluded.thumbnail, status = 'active', manifest = excluded.manifest,\n` +
        `  preview = excluded.preview, synced_at = excluded.synced_at, updated_at = now();\n`;

    if (prune) {
        sql += `\nupdate public.templates set status = 'disabled' where key not in (${rows.map((r) => lit(r.key)).join(', ')});\n`;
    }
    return sql;
}

async function push(rows: Row[], prune: boolean): Promise<void> {
    const url = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('--push needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    }

    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, { auth: { persistSession: false } });

    const { error } = await db.from('templates').upsert(rows, { onConflict: 'key' });
    if (error) throw new Error(error.message);

    if (prune) {
        const { error: e } = await db
            .from('templates')
            .update({ status: 'disabled' })
            .not('key', 'in', `(${rows.map((r) => r.key).join(',')})`);
        if (e) throw new Error(e.message);
    }
}

const rows = scan();
if (!rows.length) {
    console.warn('No templates found in ./templates');
    process.exit(0);
}

console.table(rows.map((r) => ({ key: r.key, name: r.name, version: r.version, sections: Object.keys(r.manifest.sections).length })));

if (args.has('--push')) {
    await push(rows, args.has('--prune'));
    console.log(`Pushed ${rows.length} template(s) to Supabase.`);
} else {
    const out = join(ROOT, 'supabase', 'templates.sql');
    writeFileSync(out, toSql(rows, args.has('--prune')));
    console.log(`Wrote ${out} — run it in Supabase Dashboard → SQL Editor (or re-run with --push).`);
}
