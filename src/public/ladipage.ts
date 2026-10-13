/**
 * Entry for LadiPage (pixel-perfect) templates. The server serves the ORIGINAL
 * LadiPage HTML byte-identical, plus a `window.__INV__` config. This script
 * hydrates the editable content in place (so layout/animation stay 100% original),
 * injects the flexible gallery + Supabase-wired RSVP/guestbook, then boots the
 * shared interactivity.
 */
import './public.css';
import { bootPublic } from './core';

interface InvConfig {
    text?: Record<string, string>;
    fit?: string[];
    mapUrl?: string | null;
    nav?: { label: string; section: string }[];
    hide?: string[];
    images?: Record<string, string>;
    /** element id -> background colour (dress-code swatches, ...) */
    colors?: Record<string, string>;
    /** element id -> value for the form input it wraps (guest name, ...) */
    inputs?: Record<string, string>;
    /** element id -> destination url (map buttons, QR downloads, ...) */
    links?: Record<string, string>;
    /** element id -> text copied to the clipboard on click (bank account, ...) */
    copy?: Record<string, string>;
    /** element id -> ISO date the countdown clock runs to */
    countdown?: Record<string, string>;
    /** extra copies of a block (wedding events): per item, element id -> text / url / picture */
    repeat?: {
        section: string;
        block: string;
        step: number;
        actions: Record<string, 'rsvp' | 'guestbook' | 'gallery' | 'map'>;
        items: { text: Record<string, string>; links: Record<string, string | null>; images: Record<string, string | null> }[];
    }[];
    /** element ids that must not react to clicks (logo) */
    inert?: string[];
    /** markers (calendar hearts): copies of `marker` centred on fractions of `image` */
    markers?: { image: string; marker: string; points: { x: number; y: number }[] }[];
    /** element id -> injected block it scrolls to */
    actions?: Record<string, 'rsvp' | 'guestbook' | 'gallery' | 'map'>;
    music?: string | null;
    gallery?: { thumb: string; web: string; full: string; alt?: string }[];
    sections?: { gallery?: string; rsvp?: string; guestbook?: string };
    blocks?: {
        gallery?: { heading?: string; tagline?: string };
        rsvp?: { enabled?: boolean; heading?: string; intro?: string; foods?: string[] };
        guestbook?: { enabled?: boolean; heading?: string; intro?: string };
    };
    /** Public Supabase endpoint + anon key (RSVP, guestbook, realtime). */
    api?: { url: string; key: string };
}

const cfg: InvConfig = (window as any).__INV__ ?? {};

function reveal() {
    document.getElementById('__inv_guard')?.remove();
    document.documentElement.style.visibility = '';
}

/** Put (multi-line) text into a LadiPage element's text holder; returns the holder. */
function setText(el: HTMLElement, value: string): HTMLElement {
    const holder = el.querySelector<HTMLElement>('.ladi-headline, .ladi-paragraph, .ladi-button-text, .ladi-list, .ladi-button') ?? el;
    if (value.includes('\n')) {
        holder.innerHTML = value
            .split('\n')
            .map((line) => line.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)))
            .join('<br>');
    } else {
        holder.textContent = value;
    }
    return holder;
}

function hydrateText() {
    for (const [id, value] of Object.entries(cfg.text ?? {})) {
        if (value == null || value === '') continue;
        const el = document.getElementById(id);
        if (!el) continue;
        const holder = setText(el, value);
        // Names live in fixed-width boxes; stop them wrapping/overlapping immediately.
        if (cfg.fit?.includes(id)) holder.style.whiteSpace = 'nowrap';
    }
}

/**
 * Shrink a fixed-box element's font so its (one-line) text fits the box width.
 * Run after web fonts load so the measurement uses the real glyph widths.
 */
function fitNames() {
    for (const id of cfg.fit ?? []) {
        const el = document.getElementById(id);
        if (!el) continue;
        const holder = el.querySelector<HTMLElement>('.ladi-headline, .ladi-paragraph') ?? el;
        holder.style.whiteSpace = 'nowrap';
        const boxW = el.clientWidth;
        const textW = holder.scrollWidth;
        if (boxW > 0 && textW > boxW) {
            const cur = parseFloat(getComputedStyle(holder).fontSize) || 16;
            holder.style.fontSize = `${Math.max(8, (cur * boxW) / textW * 0.97)}px`;
        }
    }
}

function hydrateImages() {
    const entries = Object.entries(cfg.images ?? {}).filter(([, u]) => u);
    if (!entries.length) return;
    const swap = (val: string): string | null => {
        for (const [fn, url] of entries) if (val.includes(fn)) return url;
        return null;
    };
    /** A different picture (not the template's own file mapped back to itself). */
    const isNew = (val: string, url: string): boolean => !val.includes(url.split('/').pop() ?? url);
    // Image boxes whose picture was swapped: LadiPage sizes/offsets that box to
    // crop the ORIGINAL photo, which mis-frames any other photo — fill the frame instead.
    const fill = new Set<string>();
    // CSS rules in the inline <style> blocks (LadiPage stores images here),
    // including the desktop/mobile ones nested in @media blocks.
    const allRules = (list: CSSRuleList): CSSRule[] =>
        Array.from(list).flatMap((r) => ('cssRules' in r && !(r instanceof CSSStyleRule) ? allRules((r as CSSGroupingRule).cssRules) : [r]));
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | undefined;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (const rule of allRules(rules)) {
            const st = (rule as CSSStyleRule).style;
            if (!st || !st.backgroundImage || st.backgroundImage === 'none') continue;
            const url = swap(st.backgroundImage);
            if (!url) continue;
            const sel = (rule as CSSStyleRule).selectorText ?? '';
            if (sel.includes('ladi-image-background') && isNew(st.backgroundImage, url)) fill.add(sel);
            st.backgroundImage = `url("${url}")`;
        }
    }
    if (fill.size) {
        const style = document.createElement('style');
        style.textContent = `${[...fill].join(',')}{top:0!important;left:0!important;width:100%!important;height:100%!important;` +
            'background-size:cover!important;background-position:center center!important}';
        document.head.appendChild(style);
    }
    // inline styles + <img>
    document.querySelectorAll<HTMLElement>('[style*="background-image"]').forEach((el) => {
        const url = swap(el.style.backgroundImage);
        if (!url) return;
        if (isNew(el.style.backgroundImage, url)) {
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center center';
        }
        el.style.backgroundImage = `url("${url}")`;
    });
    document.querySelectorAll('img').forEach((img) => {
        const url = swap(img.src);
        if (!url) return;
        if (isNew(img.src, url)) img.style.objectFit = 'cover';
        img.src = url;
    });
}

/**
 * Recolour a LadiPage box/shape — the dress-code swatches and anything else the
 * couple picks a colour for.
 */
function hydrateColors() {
    for (const [id, color] of Object.entries(cfg.colors ?? {})) {
        const el = document.getElementById(id);
        if (!el) continue;
        const svg = el.querySelector<SVGElement>('.ladi-shape svg');
        if (svg) { svg.setAttribute('fill', color); continue; }
        (el.querySelector<HTMLElement>('.ladi-box') ?? el).style.backgroundColor = color;
    }
}

/** Elements that must not be clickable: LadiPage gave the logo a lightbox of its demo file. */
function applyInert() {
    for (const id of cfg.inert ?? []) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('cursor', 'default', 'important');
    }
}

/** Drop the blocks the couple switched off (plus LadiPage's own leftovers). */
function applyHidden() {
    for (const id of cfg.hide ?? []) {
        document.getElementById(id)?.style.setProperty('display', 'none', 'important');
    }
}

/** Text shown inside a LadiPage form field (the "guest name" line on the card). */
function hydrateInputs() {
    for (const [id, value] of Object.entries(cfg.inputs ?? {})) {
        const input = document.getElementById(id)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
        if (!input) continue;
        input.value = value;
        input.placeholder = value;
    }
}

/**
 * Re-point the original CTAs (map, QR download, contact links). The href covers
 * plain navigation; wireButtons() also intercepts the click so LadiPage's own
 * handler can never win with the demo URL.
 */
function hydrateLinks() {
    for (const [id, url] of Object.entries(cfg.links ?? {})) {
        const el = document.getElementById(id);
        if (!(el instanceof HTMLAnchorElement)) continue;
        el.href = url;
        el.setAttribute('data-replace-href', url);
    }
}

/**
 * Re-target the countdown clock. LadiPage's ticker prefers the cached
 * `data-date-start`/`data-date-end` pair over its own config, so setting those
 * is enough — and it keeps ticking against the couple's own date.
 */
function hydrateCountdown() {
    for (const [id, iso] of Object.entries(cfg.countdown ?? {})) {
        const el = document.getElementById(id);
        const at = new Date(iso).getTime();
        if (!el || !Number.isFinite(at)) continue;
        el.setAttribute('data-date-start', '0');
        el.setAttribute('data-date-end', String(at));
        el.removeAttribute('data-end');
    }
}

/**
 * Extra copies of a block (more wedding events than the template has): each
 * copy sits `step` px below the previous one and the section grows to fit.
 * Copies keep the original ids so the template CSS styles them; anything that
 * must act on a copy (links, scroll buttons) is tagged with data attributes.
 */
function injectRepeats() {
    for (const r of cfg.repeat ?? []) {
        const block = document.getElementById(r.block);
        const section = document.getElementById(r.section);
        if (!block || !section || !r.items.length) continue;

        const find = (root: HTMLElement, id: string) =>
            root.id === id ? root : root.querySelector<HTMLElement>(`[id="${id}"]`);
        const top = block.offsetTop;
        let after: HTMLElement = block;

        r.items.forEach((item, i) => {
            const copy = block.cloneNode(true) as HTMLElement;
            // Not left waiting for LadiPage's lazy-load / entrance animation, which only track originals.
            for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
                el.classList.remove('ladi-lazyload', 'ladi-animation-hidden');
            }
            copy.setAttribute('data-inv-copy', '');
            copy.style.top = `${top + r.step * (i + 1)}px`;

            for (const [id, value] of Object.entries(item.text)) {
                const el = find(copy, id);
                if (el) setText(el, value);
            }
            for (const [id, url] of Object.entries(item.links)) {
                const el = find(copy, id);
                if (!el) continue;
                if (url) el.setAttribute('data-inv-link', url);
                else el.style.setProperty('display', 'none', 'important');
            }
            for (const [id, action] of Object.entries(r.actions)) {
                find(copy, id)?.setAttribute('data-inv-action', action);
            }
            for (const [id, url] of Object.entries(item.images)) {
                const bg = find(copy, id)?.querySelector<HTMLElement>('.ladi-image-background');
                if (!bg || !url) continue;
                // Inline !important beats the template CSS and any "Ảnh trong mẫu" override of the original.
                bg.style.setProperty('background-image', `url("${url.replace(/"/g, '%22')}")`, 'important');
                for (const [prop, val] of [['top', '0'], ['left', '0'], ['width', '100%'], ['height', '100%'], ['background-size', 'cover'], ['background-position', 'center center']]) {
                    bg.style.setProperty(prop, val, 'important');
                }
            }

            after.after(copy);
            after = copy;
        });

        section.style.height = `${section.offsetHeight + r.step * r.items.length}px`;
    }
}

/** Offset of `el` inside `ancestor`, ignoring transforms (entrance animations scale elements). */
function offsetWithin(el: HTMLElement, ancestor: Element): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let cur: HTMLElement | null = el;
    while (cur && cur !== ancestor) {
        x += cur.offsetLeft;
        y += cur.offsetTop;
        cur = cur.offsetParent as HTMLElement | null;
    }
    return cur ? { x, y } : null;
}

/**
 * Put the template's marker (the pulsing heart) on each chosen point of its
 * picture — one copy per point (the wedding day(s) on the couple's calendar);
 * no points hides it.
 */
function placeMarkers() {
    for (const { image, marker, points } of cfg.markers ?? []) {
        const img = document.getElementById(image);
        const heart = document.getElementById(marker);
        const parent = heart?.offsetParent;
        if (!img || !heart || !parent) continue;
        if (!points.length) { heart.style.setProperty('display', 'none', 'important'); continue; }

        const at = offsetWithin(img, parent);
        if (!at) continue;
        points.forEach((p, i) => {
            const el = i === 0 ? heart : (heart.cloneNode(true) as HTMLElement);
            el.style.left = `${at.x + p.x * img.offsetWidth - heart.offsetWidth / 2}px`;
            el.style.top = `${at.y + p.y * img.offsetHeight - heart.offsetHeight / 2}px`;
            // Copies keep the id so the template's own CSS (size, colour, pulse) applies.
            if (i > 0) heart.parentNode!.insertBefore(el, heart.nextSibling);
        });
    }
}

function hydrateMusic() {
    if (!cfg.music) return;
    const audio = document.querySelector<HTMLAudioElement>('audio');
    if (audio) { audio.src = cfg.music; audio.setAttribute('data-audio', ''); }
}

function container(sectionId?: string): HTMLElement | null {
    if (!sectionId) return null;
    const sec = document.getElementById(sectionId);
    return sec ? (sec.querySelector<HTMLElement>('.ladi-container') ?? sec) : null;
}

function injectGallery() {
    const host = container(cfg.sections?.gallery);
    if (!host || !cfg.gallery?.length) return;
    const figs = cfg.gallery
        .map((g) => `<figure><img loading="lazy" src="${g.thumb}" data-lightbox data-full="${g.full}" alt="${g.alt ?? ''}"></figure>`)
        .join('');
    host.innerHTML = `<div class="inv-injected">
        <h2 class="inv-injected__title">${cfg.blocks?.gallery?.heading ?? 'Album Ảnh'}</h2>
        ${cfg.blocks?.gallery?.tagline ? `<p class="inv-injected__sub">${cfg.blocks.gallery.tagline}</p>` : ''}
        <div class="inv-grid">${figs}</div>
    </div>`;
    host.removeAttribute('style');
    host.style.height = 'auto';
}

function injectRsvp() {
    const b = cfg.blocks?.rsvp;
    const host = container(cfg.sections?.rsvp);
    if (!host || !b?.enabled) return;
    const foods = (b.foods ?? []).map((f) => `<option value="${f}">${f}</option>`).join('');
    host.innerHTML = `<div class="inv-injected">
        <h2 class="inv-injected__title">${b.heading ?? 'Xác Nhận Tham Dự'}</h2>
        ${b.intro ? `<p class="inv-injected__sub">${b.intro}</p>` : ''}
        <p class="inv-counter">Đã có <strong data-rsvp-guests>0</strong> khách xác nhận tham dự</p>
        <form class="inv-pubform" data-rsvp-form>
            <div class="inv-pubform__row">
                <input name="name" placeholder="Họ và tên" required maxlength="120">
                <input name="phone" placeholder="Số điện thoại" maxlength="20">
            </div>
            <div class="inv-pubform__row">
                <select name="attendance"><option value="yes">Tôi sẽ tham dự</option><option value="no">Rất tiếc, tôi không thể</option><option value="maybe">Chưa chắc chắn</option></select>
                <input type="number" name="guest_count" min="1" max="20" value="1" style="max-width:110px">
            </div>
            ${foods ? `<select name="food_option"><option value="">-- Chọn món --</option>${foods}</select>` : ''}
            <textarea name="notes" placeholder="Lời nhắn (tuỳ chọn)" maxlength="500"></textarea>
            <button type="submit">Xác nhận tham dự</button>
            <p data-form-msg style="text-align:center;min-height:1.2em"></p>
        </form>
    </div>`;
    host.removeAttribute('style');
    host.style.height = 'auto';
}

function injectGuestbook() {
    const b = cfg.blocks?.guestbook;
    const host = container(cfg.sections?.guestbook);
    if (!host || !b?.enabled) return;
    host.innerHTML = `<div class="inv-injected">
        <h2 class="inv-injected__title">${b.heading ?? 'Gửi Lời Chúc'}</h2>
        ${b.intro ? `<p class="inv-injected__sub">${b.intro}</p>` : ''}
        <form class="inv-pubform" data-guestbook-form>
            <input name="name" placeholder="Họ và tên" required maxlength="80">
            <div class="inv-emoji" role="radiogroup" aria-label="Biểu tượng">${['❤️', '🎉', '🥰', '🌸', '💐', '🥂']
                .map((e, i) => `<label><input type="radio" name="emoji" value="${e}"${i ? '' : ' checked'}><span>${e}</span></label>`)
                .join('')}</div>
            <textarea name="message" placeholder="Lời chúc của bạn..." required maxlength="500"></textarea>
            <button type="submit">Gửi lời chúc</button>
            <p data-form-msg style="text-align:center;min-height:1.2em"></p>
        </form>
        <div class="inv-wishes" data-wishes style="max-width:520px;margin:24px auto 0;display:grid;gap:12px;max-height:360px;overflow:auto"></div>
    </div>`;
    host.removeAttribute('style');
    host.style.height = 'auto';
}

/** Copy to clipboard, with a fallback for browsers/contexts without the API. */
function copyText(text: string) {
    navigator.clipboard?.writeText(text).catch(() => fallbackCopy(text)) ?? fallbackCopy(text);
}

function fallbackCopy(text: string) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    ta.remove();
}

/**
 * Deterministic click layer for the original LadiPage CTAs/menu (the scraped
 * LadiPage runtime doesn't reliably handle clicks offline). Buttons are routed
 * by their manifest element id where one is mapped, and by their text otherwise
 * — so renaming a button's label never breaks where it goes.
 */
function wireButtons() {
    const sec = cfg.sections ?? {};
    const blocks: Record<string, string | undefined> = { rsvp: sec.rsvp, guestbook: sec.guestbook, gallery: sec.gallery };
    const rules: Array<[RegExp, string | undefined]> = [
        [/(xác nhận|tham dự|đặt ngay|phản hồi|r\.?s\.?v\.?p)/i, sec.rsvp],
        [/(lời chúc|chúc mừng|sổ lưu|gửi lời)/i, sec.guestbook],
        [/(album|ảnh cưới|hình ảnh|xem thêm hình)/i, sec.gallery],
    ];
    const scrollTo = (id?: string) => {
        const el = id ? document.getElementById(id) : null;
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return true; }
        return false;
    };
    /** First mapped element id in `map` that contains the clicked node. */
    const hit = (map: Record<string, string>, node: HTMLElement): string | undefined =>
        Object.keys(map).find((id) => document.getElementById(id)?.contains(node));

    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Never hijack our own injected gallery / forms / wishes / nav.
        if (target?.closest?.('.inv-injected, .inv-pubform, [data-wishes], .inv-drawer, .inv-fab')) return;

        // Copies of repeated blocks (extra events) carry their own targets.
        const tagged = target?.closest?.<HTMLElement>('[data-inv-link], [data-inv-action]');
        if (tagged) {
            e.preventDefault(); e.stopPropagation();
            const url = tagged.getAttribute('data-inv-link');
            if (url) window.open(url, '_blank', 'noopener');
            else scrollTo(blocks[tagged.getAttribute('data-inv-action') ?? '']);
            return;
        }

        const links = cfg.links ?? {};
        const linkId = hit(links, target);
        if (linkId) {
            e.preventDefault(); e.stopPropagation();
            window.open(links[linkId], '_blank', 'noopener');
            return;
        }

        const copies = cfg.copy ?? {};
        const copyId = hit(copies, target);
        if (copyId) {
            e.preventDefault(); e.stopPropagation();
            copyText(copies[copyId]);
            return;
        }

        const actions = cfg.actions ?? {};
        const actionId = hit(actions as Record<string, string>, target);
        if (actionId) {
            const action = actions[actionId];
            if (action === 'map') {
                if (cfg.mapUrl) { e.preventDefault(); e.stopPropagation(); window.open(cfg.mapUrl, '_blank', 'noopener'); }
                return;
            }
            if (scrollTo(blocks[action])) { e.preventDefault(); e.stopPropagation(); }
            return;
        }

        const el = target?.closest?.('[data-action="true"], .ladi-button, a.ladi-element, .ladi-headline');
        if (!el) return;
        const txt = (el.textContent ?? '').trim().toLowerCase();
        if (!txt) return;
        if (/(bản đồ|chỉ đường|xem map)/i.test(txt)) {
            if (cfg.mapUrl) { e.preventDefault(); e.stopPropagation(); window.open(cfg.mapUrl, '_blank', 'noopener'); }
            return;
        }
        for (const [re, id] of rules) {
            if (id && re.test(txt) && scrollTo(id)) { e.preventDefault(); e.stopPropagation(); return; }
        }
    }, true);
}

/**
 * Replace the original (broken offline) floating buttons + menu with our own
 * working ↑ scroll-top + ☰ menu drawer, built from the manifest nav map.
 */
function injectNav() {
    const nav = cfg.nav ?? [];
    const fab = document.createElement('div');
    fab.className = 'inv-fab';
    fab.innerHTML =
        '<button class="inv-fab__btn" data-inv-top aria-label="Lên đầu trang">↑</button>' +
        (nav.length ? '<button class="inv-fab__btn" data-inv-menu aria-label="Menu">☰</button>' : '');
    document.body.appendChild(fab);

    fab.querySelector('[data-inv-top]')!.addEventListener('click', () =>
        window.scrollTo({ top: 0, behavior: 'smooth' }),
    );

    if (!nav.length) return;

    const drawer = document.createElement('nav');
    drawer.className = 'inv-drawer';
    drawer.innerHTML = nav.map((n) => `<a href="#" data-sec="${n.section}">${n.label}</a>`).join('');
    document.body.appendChild(drawer);

    fab.querySelector('[data-inv-menu]')!.addEventListener('click', (e) => {
        e.stopPropagation();
        drawer.classList.toggle('open');
    });
    drawer.querySelectorAll('a').forEach((a) =>
        a.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById((a as HTMLElement).dataset.sec!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            drawer.classList.remove('open');
        }),
    );
    document.addEventListener('click', (e) => {
        if (!drawer.contains(e.target as Node) && !fab.contains(e.target as Node)) drawer.classList.remove('open');
    });
}

/**
 * Never show LadiPage's "Powered by ladipage" badge. The runtime adds it under a
 * random class name (so no static CSS can target it); the shipped runtimes are
 * patched, and this also removes it if a browser still runs a cached copy.
 */
function blockBranding() {
    const isBadge = (el: Element) =>
        el.parentElement === document.body && getComputedStyle(el).backgroundImage.includes('/by/ladipage.svg');
    const sweep = () => document.body.querySelectorAll(':scope > div').forEach((el) => isBadge(el) && el.remove());
    sweep();
    const obs = new MutationObserver(sweep);
    obs.observe(document.body, { childList: true });
    obs.observe(document.head, { childList: true });
    setTimeout(() => obs.disconnect(), 20000);
}

function run() {
    try {
        blockBranding();
        applyHidden();
        applyInert();
        hydrateText();
        hydrateImages();
        hydrateColors();
        hydrateInputs();
        hydrateLinks();
        injectRepeats();
        hydrateCountdown();
        placeMarkers();
        hydrateMusic();
        injectGallery();
        injectRsvp();
        injectGuestbook();
    } catch (e) {
        console.error('hydration error', e);
    }
    reveal();
    bootPublic();
    wireButtons();
    injectNav();

    // Fit names once now and again after web fonts finish loading (accurate widths).
    fitNames();
    (document as any).fonts?.ready?.then(fitNames).catch(() => {});
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
} else {
    run();
}
// Safety: never leave the page hidden if something throws before reveal().
setTimeout(reveal, 2500);
