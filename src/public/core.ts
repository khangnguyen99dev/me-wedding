/**
 * Shared public-page interactivity:
 *  - LadiPage pixel-perfect templates (ladipage.ts), after hydration
 *
 * Everything is driven by data-attributes so it is template-agnostic.
 *
 * @supabase/supabase-js is NOT imported statically: it is dynamically
 * imported inside initRealtime() so the realtime code splits into its own
 * chunk and never blocks the invitation's first paint.
 */

/* ----------------------------- Countdown ----------------------------- */
function initCountdowns(): void {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-countdown]'));
    if (!els.length) return;
    const pad = (n: number) => String(Math.max(0, n)).padStart(2, '0');
    const tick = () => {
        const now = Date.now();
        for (const el of els) {
            const target = new Date(el.dataset.countdown ?? '').getTime();
            if (Number.isNaN(target)) continue;
            const diff = Math.max(0, target - now);
            const set = (u: string, v: string) => {
                const n = el.querySelector<HTMLElement>(`[data-cd="${u}"]`);
                if (n) n.textContent = v;
            };
            set('days', String(Math.floor(diff / 86_400_000)));
            set('hours', pad(Math.floor((diff % 86_400_000) / 3_600_000)));
            set('minutes', pad(Math.floor((diff % 3_600_000) / 60_000)));
            set('seconds', pad(Math.floor((diff % 60_000) / 1000)));
        }
    };
    tick();
    window.setInterval(tick, 1000);
}

/* ------------------------------- Music ------------------------------- */
function initMusic(): void {
    const audio = document.querySelector<HTMLAudioElement>('audio[data-audio], audio');
    const btn = document.querySelector<HTMLElement>('[data-music-toggle]');
    if (!audio) return;
    const play = () => audio.play().then(() => btn?.classList.add('playing')).catch(() => {});
    const pause = () => { audio.pause(); btn?.classList.remove('playing'); };
    btn?.addEventListener('click', () => (audio.paused ? play() : pause()));
    const tryAutoplay = () => { play(); window.removeEventListener('pointerdown', tryAutoplay); };
    window.addEventListener('pointerdown', tryAutoplay, { once: true });
}

/* ------------------------------ Reveal ------------------------------- */
function initReveal(): void {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!els.length || !('IntersectionObserver' in window)) {
        els.forEach((el) => el.classList.add('is-visible'));
        return;
    }
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
}

/* ----------------------------- Lightbox ------------------------------ */
function initLightbox(): void {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('[data-lightbox]'));
    if (!imgs.length) return;
    const overlay = document.createElement('div');
    overlay.className = 'inv-lightbox';
    overlay.innerHTML = '<img alt="" />';
    const big = overlay.querySelector('img') as HTMLImageElement;
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove('open');
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    imgs.forEach((img) => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => { big.src = img.dataset.full || img.currentSrc || img.src; overlay.classList.add('open'); });
    });
}

/* ------------------- RSVP + Guestbook + realtime --------------------- */
/*
 * Everything goes straight to Supabase with the public anon key:
 *   - PostgREST RPCs (public_guestbook, public_rsvp_stats, submit_rsvp, submit_guestbook)
 *     which only ever touch PUBLISHED invitations, sanitize input and rate-limit by IP
 *   - Realtime broadcast on topic "invitation:{id}", fed by database triggers
 */
const renderedWishIds = new Set<number>();

interface PublicApi { url: string; key: string }

function api(): PublicApi | null {
    const a = (window as any).__INV__?.api as PublicApi | undefined;
    return a?.url && a?.key ? a : null;
}

async function rpc(fn: string, body: Record<string, unknown>): Promise<any> {
    const a = api();
    if (!a) throw { message: 'Chưa cấu hình kết nối máy chủ.' };
    const res = await fetch(`${a.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: a.key, Authorization: `Bearer ${a.key}` },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw data;
    return data;
}
function setMsg(form: HTMLFormElement, text: string, ok: boolean) {
    const el = form.querySelector<HTMLElement>('[data-form-msg]');
    if (el) { el.textContent = text; el.style.color = ok ? '#2e7d32' : '#c62828'; }
}
export function spawnHearts(count = 6): void {
    const wrap = document.getElementById('inv-hearts');
    if (!wrap) return;
    const emojis = ['❤️', '🥰', '💕', '🌸', '🎉'];
    for (let i = 0; i < count; i++) {
        const h = document.createElement('div');
        h.className = 'inv-heart';
        h.textContent = emojis[i % emojis.length];
        h.style.left = `${10 + Math.floor((i / count) * 80)}%`;
        h.style.animationDelay = `${(i % 4) * 0.15}s`;
        wrap.appendChild(h);
        setTimeout(() => h.remove(), 4500);
    }
}
export function addWish(w: { id: number; name: string; message: string; emoji?: string | null }, isNew = false): void {
    const list = document.querySelector<HTMLElement>('[data-wishes]');
    if (!list || renderedWishIds.has(w.id)) return;
    renderedWishIds.add(w.id);
    const card = document.createElement('div');
    card.className = 'inv-wish' + (isNew ? ' inv-wish--new' : '');
    const name = document.createElement('p');
    name.className = 'inv-wish__name';
    name.textContent = `${w.name} ${w.emoji ?? ''}`.trim();
    const msg = document.createElement('p');
    msg.className = 'inv-wish__msg';
    msg.textContent = w.message;
    card.append(name, msg);
    list.prepend(card);
}
function setGuestCount(n: number) {
    document.querySelectorAll<HTMLElement>('[data-rsvp-guests]').forEach((el) => (el.textContent = String(n)));
}

function slug(): string { return document.body.dataset.slug ?? ''; }

async function loadInitial() {
    if (!slug() || !api()) return;
    try {
        const wishes = await rpc('public_guestbook', { p_slug: slug() });
        (Array.isArray(wishes) ? wishes : []).reverse().forEach((w: any) => addWish(w));
    } catch { /* ignore */ }
    try {
        const stats = await rpc('public_rsvp_stats', { p_slug: slug() });
        setGuestCount(stats?.attending_guests ?? 0);
    } catch { /* ignore (e.g. preview of an unpublished draft) */ }
}
function errorText(err: any): string {
    return typeof err?.message === 'string' && err.message ? err.message : 'Có lỗi, thử lại.';
}
function wireForms() {
    const rsvp = document.querySelector<HTMLFormElement>('[data-rsvp-form]');
    rsvp?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(rsvp)) as Record<string, string>;
        try {
            const res = await rpc('submit_rsvp', {
                p_slug: slug(),
                p_name: f.name ?? '',
                p_phone: f.phone || null,
                p_guest_count: Number(f.guest_count) || 1,
                p_attendance: f.attendance || 'yes',
                p_food_option: f.food_option || null,
                p_notes: f.notes || null,
            });
            setMsg(rsvp, res.message ?? 'Cảm ơn bạn!', true);
            setGuestCount(res.stats?.attending_guests ?? 0);
            spawnHearts();
            rsvp.reset();
        } catch (err: any) { setMsg(rsvp, errorText(err), false); }
    });
    const gb = document.querySelector<HTMLFormElement>('[data-guestbook-form]');
    gb?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(gb)) as Record<string, string>;
        try {
            const res = await rpc('submit_guestbook', {
                p_slug: slug(),
                p_name: f.name ?? '',
                p_message: f.message ?? '',
                p_emoji: f.emoji || null,
            });
            setMsg(gb, res.message ?? 'Cảm ơn!', true);
            if (res.approved && res.data) addWish(res.data, true);
            spawnHearts();
            gb.reset();
        } catch (err: any) { setMsg(gb, errorText(err), false); }
    });
}
async function initRealtime(): Promise<void> {
    const id = document.body.dataset.invitation;
    const a = api();
    if (!id || !a) return;
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const client = createClient(a.url, a.key, { auth: { persistSession: false, autoRefreshToken: false } });
        client
            .channel(`invitation:${id}`)
            .on('broadcast', { event: 'guestbook' }, ({ payload }) => { addWish(payload as any, true); spawnHearts(4); })
            .on('broadcast', { event: 'rsvp' }, ({ payload }) => setGuestCount((payload as any)?.attending_guests ?? 0))
            .subscribe();
    } catch { /* best-effort */ }
}

/** Run a non-critical task when the browser is idle (falls back to a timeout). */
function whenIdle(fn: () => void): void {
    const ric = (window as any).requestIdleCallback as
        | ((cb: () => void, opts?: { timeout: number }) => void)
        | undefined;
    if (ric) ric(fn, { timeout: 3000 });
    else window.setTimeout(fn, 1200);
}

/** Boot every interactive feature. Safe to call once after the DOM is ready. */
export function bootPublic(): void {
    initCountdowns();
    initMusic();
    initReveal();
    initLightbox();
    loadInitial();
    wireForms();
    // Realtime (websocket + supabase-js chunk) is non-critical — defer to idle
    // so it never competes with the initial render/hydration.
    whenIdle(() => { void initRealtime(); });
}
