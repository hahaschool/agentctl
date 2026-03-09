import { expect, type Locator, test } from '@playwright/test';

type ThemeMode = 'light' | 'dark';

type ActionTarget = {
  role: 'link' | 'button';
  name: string;
};

const DASHBOARD_ACTIONS: ActionTarget[] = [
  { role: 'link', name: 'New Session' },
  { role: 'link', name: 'View Agents' },
  { role: 'button', name: 'Refresh' },
];

const MIN_CONTRAST_RATIO = 4.5; // WCAG AA for normal-size text

async function openDashboardInTheme(
  page: import('@playwright/test').Page,
  theme: ThemeMode,
): Promise<void> {
  await page.addInitScript((preferredTheme: ThemeMode) => {
    window.localStorage.setItem('theme', preferredTheme);
  }, theme);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.waitForFunction(
    (expectedTheme: ThemeMode) =>
      document.documentElement.classList.contains('dark') === (expectedTheme === 'dark'),
    theme,
  );
}

async function getContrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    type Rgba = { r: number; g: number; b: number; a: number };

    const normalizeToRgb = (raw: string): string => {
      const probe = document.createElement('span');
      probe.style.color = raw;
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const normalized = window.getComputedStyle(probe).color;
      probe.remove();
      return normalized;
    };

    const parseHex = (hex: string): Rgba => {
      const normalized = hex.replace('#', '').trim();
      if (normalized.length === 3 || normalized.length === 4) {
        const r = Number.parseInt(normalized[0] + normalized[0], 16);
        const g = Number.parseInt(normalized[1] + normalized[1], 16);
        const b = Number.parseInt(normalized[2] + normalized[2], 16);
        const a =
          normalized.length === 4 ? Number.parseInt(normalized[3] + normalized[3], 16) / 255 : 1;
        return { r, g, b, a };
      }

      if (normalized.length === 6 || normalized.length === 8) {
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        const a = normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a };
      }

      throw new Error(`Unsupported hex color: ${hex}`);
    };

    const parseAlphaToken = (token: string | undefined): number => {
      if (!token) return 1;
      if (token.endsWith('%')) return Number.parseFloat(token.slice(0, -1)) / 100;
      return Number.parseFloat(token);
    };

    const parseLab = (labValue: string): Rgba => {
      const match = labValue.match(/^lab\((.+)\)$/);
      if (!match) {
        throw new Error(`Unsupported lab color: ${labValue}`);
      }

      const content = match[1].trim();
      const [left, alphaPart] = content.includes('/') ? content.split('/') : [content, undefined];
      const channels = left.trim().split(/\s+/).filter(Boolean);

      if (channels.length < 3) {
        throw new Error(`Invalid lab color channels: ${labValue}`);
      }

      const lRaw = channels[0] ?? '0';
      const l = lRaw.endsWith('%') ? Number.parseFloat(lRaw.slice(0, -1)) : Number.parseFloat(lRaw);
      const a = Number.parseFloat(channels[1] ?? '0');
      const b = Number.parseFloat(channels[2] ?? '0');
      const alpha = parseAlphaToken(alphaPart?.trim());

      // CSS lab() is CIELAB with D50 white point.
      const fy = (l + 16) / 116;
      const fx = fy + a / 500;
      const fz = fy - b / 200;
      const delta = 6 / 29;
      const finv = (t: number): number => (t > delta ? t ** 3 : 3 * delta ** 2 * (t - 4 / 29));

      const Xn = 0.96422;
      const Yn = 1;
      const Zn = 0.82521;

      const xD50 = Xn * finv(fx);
      const yD50 = Yn * finv(fy);
      const zD50 = Zn * finv(fz);

      // Bradford-adapted D50 -> D65.
      const x = 0.9555766 * xD50 + -0.0230393 * yD50 + 0.0631636 * zD50;
      const y = -0.0282895 * xD50 + 1.0099416 * yD50 + 0.0210077 * zD50;
      const z = 0.0122982 * xD50 + -0.020483 * yD50 + 1.3299098 * zD50;

      let rLin = 3.2404542 * x + -1.5371385 * y + -0.4985314 * z;
      let gLin = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
      let bLin = 0.0556434 * x + -0.2040259 * y + 1.0572252 * z;

      const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
      rLin = clamp01(rLin);
      gLin = clamp01(gLin);
      bLin = clamp01(bLin);

      const encodeSrgb = (linear: number): number =>
        linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;

      return {
        r: encodeSrgb(rLin) * 255,
        g: encodeSrgb(gLin) * 255,
        b: encodeSrgb(bLin) * 255,
        a: Number.isFinite(alpha) ? alpha : 1,
      };
    };

    const parseRgb = (value: string): Rgba => {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'transparent') {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      if (normalized.startsWith('#')) {
        return parseHex(normalized);
      }

      if (normalized.startsWith('lab(')) {
        return parseLab(normalized);
      }

      const match = normalized.match(/^rgba?\(([^)]+)\)$/);
      if (match) {
        const rawParts = match[1]
          .replaceAll(',', ' ')
          .replace('/', ' ')
          .split(/\s+/)
          .filter(Boolean);

        const parseChannel = (token: string): number => {
          if (token.endsWith('%')) {
            const percentage = Number.parseFloat(token.slice(0, -1));
            return (percentage / 100) * 255;
          }
          return Number.parseFloat(token);
        };

        const r = parseChannel(rawParts[0] ?? '0');
        const g = parseChannel(rawParts[1] ?? '0');
        const b = parseChannel(rawParts[2] ?? '0');
        const a = parseAlphaToken(rawParts[3]);

        return {
          r: Number.isFinite(r) ? r : 0,
          g: Number.isFinite(g) ? g : 0,
          b: Number.isFinite(b) ? b : 0,
          a: Number.isFinite(a) ? a : 1,
        };
      }

      const normalizedRgb = normalizeToRgb(value);
      if (normalizedRgb !== value) {
        return parseRgb(normalizedRgb);
      }

      throw new Error(`Unsupported color format: ${value}`);
    };

    const composite = (foreground: Rgba, background: Rgba): Rgba => {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha <= 0) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };

    const findEffectiveBackground = (node: Element): Rgba => {
      let current: Element | null = node;

      while (current) {
        const color = parseRgb(window.getComputedStyle(current).backgroundColor);
        if (color.a > 0) {
          return color;
        }
        current = current.parentElement;
      }

      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const toLinear = (channel: number): number => {
      const srgb = channel / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };

    const luminance = (color: Rgba): number =>
      0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);

    const fgRaw = parseRgb(window.getComputedStyle(element).color);
    const bg = findEffectiveBackground(element);
    const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;

    const fgL = luminance(fg);
    const bgL = luminance(bg);
    const lighter = Math.max(fgL, bgL);
    const darker = Math.min(fgL, bgL);
    return (lighter + 0.05) / (darker + 0.05);
  });
}

test.describe('Dashboard action contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`top action labels meet contrast requirements in ${theme} mode`, async ({ page }) => {
      await openDashboardInTheme(page, theme);

      for (const target of DASHBOARD_ACTIONS) {
        const locator =
          target.role === 'link'
            ? page.getByRole('link', { name: target.name, exact: true })
            : page.getByRole('button', { name: target.name, exact: true });
        await expect(locator).toBeVisible();

        const ratio = await getContrastRatio(locator);
        expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
      }
    });
  }
});
