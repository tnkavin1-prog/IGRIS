export function installGrain(el: HTMLElement, tile = 160, alpha = 28): void {
  const c = document.createElement('canvas');
  c.width = c.height = tile;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(tile, tile);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  el.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
}
