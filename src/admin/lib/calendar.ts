/**
 * Find the highlighted day cell(s) of a calendar picture — the grey / coloured
 * box apps put on the chosen date — so the heart can be placed on it.
 *
 * The picture is drawn the way the page shows it (cover-cropped into a box of
 * `aspect` = width / height); returned points are fractions of that box.
 * Heuristic: pixels clearly different from the dominant background colour and
 * not dark text, grouped into solid, roughly square blobs of day-cell size.
 */
export async function findHighlightedDays(url: string, aspect: number): Promise<{ x: number; y: number }[]> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Không đọc được ảnh lịch'));
        el.src = url;
    });

    const W = 240;
    const H = Math.round(W / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const px = ctx.getImageData(0, 0, W, H).data;

    // Dominant (background) colour, from a coarse histogram.
    const hist = new Map<number, number>();
    for (let i = 0; i < px.length; i += 4) {
        const q = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
        hist.set(q, (hist.get(q) ?? 0) + 1);
    }
    const bgKey = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8];

    const mask = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
        const [r, g, b] = [px[p * 4], px[p * 4 + 1], px[p * 4 + 2]];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
        mask[p] = lum > 90 && dist > 28 ? 1 : 0;
    }

    // Connected blobs (4-neighbour flood fill).
    const seen = new Uint8Array(W * H);
    const found: { x: number; y: number; area: number }[] = [];
    const stack: number[] = [];
    for (let start = 0; start < W * H; start++) {
        if (!mask[start] || seen[start]) continue;
        let area = 0;
        let [x0, y0, x1, y1] = [W, H, 0, 0];
        stack.push(start);
        seen[start] = 1;
        while (stack.length) {
            const p = stack.pop()!;
            const x = p % W;
            const y = (p - x) / W;
            area++;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x);
            y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            for (const n of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
                if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
            }
        }
        const [bw, bh] = [x1 - x0 + 1, y1 - y0 + 1];
        const cellSized = bw < W * 0.3 && bh < H * 0.3 && area >= W * H * 0.004;
        const solid = area / (bw * bh) >= 0.55 && bw / bh >= 0.5 && bw / bh <= 2;
        if (cellSized && solid) found.push({ x: (x0 + x1 + 1) / 2 / W, y: (y0 + y1 + 1) / 2 / H, area });
    }

    return found
        .sort((a, b) => b.area - a.area)
        .slice(0, 6)
        .map(({ x, y }) => ({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }));
}
