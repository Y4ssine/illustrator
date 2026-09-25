/**
 * Infographic commands: one command builds any block from pasted data
 * (fits the selected placeholder or the artboard), plus palette shortcuts.
 */

import type { CommandPlan, DocumentCommand } from '../core/commands/types';
import { requireDoc, subjectItems } from '../core/commands/helpers';
import { activePalette, fontStacks, selectionRect, targetArtboard } from '../core/commands/creative';
import type { Place } from '../core/protocol';
import type { Rect } from '../geometry/rect';
import type { Settings } from '../core/settings';
import type { IconId } from './icons';
import * as E from './info-engine';

export interface InfoParams {
  block: E.InfoBlockId;
  data: string;
  columns: number;
  suffix: string;
  icons: boolean;
  showValues: boolean;
  thickness: number;
  center: string;
  legend: boolean;
  badge: 'circle' | 'hexagon' | 'square';
  numbered: boolean;
  titleA: string;
  titleB: string;
  total: number;
  perRow: number;
  icon: IconId;
  caption: string;
  title: string;
  subtitle: string;
  kicker: string;
  card: E.CardStyle;
  theme: 'light' | 'dark';
  roundness: number;
  direction: 'auto' | 'rtl' | 'ltr';
  digits: 'auto' | 'western' | 'arabic';
  /** Fit the selected object (e.g. a placeholder rectangle) instead of the artboard. */
  fitSelection: boolean;
}

export const SAMPLE_DATA: Record<E.InfoBlockId, { ar: string; en: string }> = {
  statCards: { ar: 'حاج | 1,833,164 | من أكثر من 150 دولة\nمتطوع | 45,000\nساعة خدمة | 24/7', en: 'Visitors | 1,833,164 | from 150+ countries\nVolunteers | 45,000\nService hours | 24/7' },
  barH: { ar: 'آسيا | 63\nأفريقيا | 21\nأوروبا | 9\nالأمريكتان | 7', en: 'Asia | 63\nAfrica | 21\nEurope | 9\nAmericas | 7' },
  barV: { ar: '2022 | 120\n2023 | 180\n2024 | 240\n2025 | 310\n2026 | 420', en: '2022 | 120\n2023 | 180\n2024 | 240\n2025 | 310\n2026 | 420' },
  donut: { ar: 'من الخارج | 1611310\nمن الداخل | 221854', en: 'International | 1611310\nDomestic | 221854' },
  pie: { ar: 'رقمي | 58\nمباشر | 27\nهاتفي | 15', en: 'Digital | 58\nIn person | 27\nPhone | 15' },
  progress: { ar: 'رضا المستفيدين | 96%\nالخدمات الرقمية | 82%\nالنقل | 74%', en: 'Satisfaction | 96%\nDigital services | 82%\nTransport | 74%' },
  rings: { ar: 'الرضا | 96%\nالرقمنة | 82%\nالنقل | 74%\nالسكن | 91%', en: 'Satisfaction | 96%\nDigital | 82%\nTransport | 74%\nHousing | 91%' },
  steps: { ar: 'التسجيل | 1 | عبر المنصة\nالموافقة | 2 | خلال 48 ساعة\nالدفع | 3 | إلكترونياً\nالاستلام | 4 | في الموعد', en: 'Register | 1 | on the platform\nApproval | 2 | within 48 h\nPayment | 3 | online\nPick-up | 4 | on the day' },
  timelineV: { ar: 'التأسيس | 1932 | توحيد المملكة\nالرؤية | 2016 | إطلاق رؤية 2030\nالإنجاز | 2030 | تحقيق المستهدفات', en: 'Founded | 1932 | the beginning\nVision | 2016 | a new strategy\nGoal | 2030 | targets achieved' },
  timelineH: { ar: 'البداية | 2019\nالتوسع | 2021\nالريادة | 2023\nالعالمية | 2026', en: 'Start | 2019\nGrowth | 2021\nLeadership | 2023\nGlobal | 2026' },
  comparison: { ar: 'الرضا | 72 | 91\nالسرعة | 55 | 88\nالتكلفة | 60 | 40', en: 'Satisfaction | 72 | 91\nSpeed | 55 | 88\nCost | 60 | 40' },
  pictogram: { ar: 'من كل 10 أشخاص | 7', en: 'out of 10 people | 7' },
  iconList: { ar: 'سهولة الوصول | 0 | خدمات متاحة على مدار الساعة\nأمان عالٍ | 0 | حماية كاملة للبيانات\nسرعة الإنجاز | 0 | إجراءات رقمية بالكامل', en: 'Easy access | 0 | services available 24/7\nSecure | 0 | full data protection\nFast | 0 | fully digital process' },
  header: { ar: '', en: '' },
};

const ICON_BY_BLOCK: Partial<Record<E.InfoBlockId, IconId[]>> = {
  statCards: ['people', 'heart', 'clock', 'pin', 'chart', 'star'],
  iconList: ['check', 'target', 'bolt', 'star', 'heart'],
  steps: ['pin', 'check', 'coin', 'star', 'home'],
};

export function defaultInfoParams(block: E.InfoBlockId, settings: Settings): InfoParams {
  const ar = settings.direction === 'rtl';
  const data = SAMPLE_DATA[block][ar ? 'ar' : 'en'];
  return {
    block,
    data,
    columns: 3,
    suffix: block === 'barH' ? '%' : '',
    icons: true,
    showValues: true,
    thickness: block === 'pie' ? 100 : block === 'rings' ? 16 : block === 'progress' ? 22 : 34,
    center: ar ? '٨٨٪' : '88%',
    legend: true,
    badge: 'circle',
    numbered: true,
    titleA: ar ? 'قبل' : 'Before',
    titleB: ar ? 'بعد' : 'After',
    total: 10,
    perRow: 10,
    icon: 'person',
    caption: ar ? '٧ من كل ١٠ أشخاص' : '7 out of 10 people',
    title: ar ? 'الحج بالأرقام' : 'The year in numbers',
    subtitle: ar ? 'أبرز الأرقام والإحصاءات لهذا العام' : 'Key numbers and highlights from this year',
    kicker: ar ? 'إنفوجرافيك' : 'INFOGRAPHIC',
    card: 'soft',
    theme: 'light',
    roundness: 0.14,
    direction: 'auto',
    digits: 'auto',
    fitSelection: false,
  };
}

const HEIGHT: Record<E.InfoBlockId, number> = {
  statCards: 0.24,
  barH: 0.3,
  barV: 0.34,
  donut: 0.3,
  pie: 0.3,
  progress: 0.28,
  rings: 0.2,
  steps: 0.24,
  timelineV: 0.55,
  timelineH: 0.26,
  comparison: 0.36,
  pictogram: 0.18,
  iconList: 0.38,
  header: 0.16,
};

export function infoBox(block: E.InfoBlockId, artboard: Rect): Rect {
  const m = artboard.w * 0.08;
  const h = artboard.h * HEIGHT[block];
  const y = block === 'header' ? artboard.y + m : artboard.y + (artboard.h - h) / 2;
  return { x: artboard.x + m, y, w: artboard.w - 2 * m, h };
}

function parseRows(text: string): Array<{ label: string; a: number; b: number }> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s*[|\t]\s*/);
      const num = (s: string | undefined): number => Number(E.westernDigits(s ?? '0').replace(/[^\d.-]/g, '')) || 0;
      return { label: parts[0] ?? '', a: num(parts[1]), b: num(parts[2]) };
    });
}

export function planInfo(settings: Settings, p: InfoParams, box: Rect, sink: Parameters<typeof E.statCards>[0]['sink'], into: Place): E.InfoResult {
  const text = `${p.data} ${p.title} ${p.subtitle} ${p.caption} ${p.titleA}`;
  const rtl = p.direction === 'auto' ? E.hasArabic(text) || (settings.direction === 'rtl' && !/[A-Za-z]/.test(text)) : p.direction === 'rtl';
  const digits = p.digits === 'auto' ? settings.digits : p.digits;
  const fonts = fontStacks(settings, rtl);
  const style: E.InfoStyle = { palette: activePalette(settings), rtl, digits, fontsBold: fonts.bold, fontsRegular: fonts.regular, theme: p.theme, card: p.card, roundness: p.roundness };
  const ctx: E.InfoContext = { sink, into, box, style };
  const items = E.parseInfoData(p.data);
  const icons = ICON_BY_BLOCK[p.block];
  if (icons) items.forEach((it, i) => (it.icon = it.icon ?? icons[i % icons.length]));
  switch (p.block) {
    case 'statCards':
      return E.statCards(ctx, items, { columns: p.columns, icons: p.icons, suffix: p.suffix });
    case 'barH':
    case 'barV':
      return E.barChart(ctx, items, { orientation: p.block === 'barH' ? 'horizontal' : 'vertical', showValues: p.showValues, suffix: p.suffix });
    case 'donut':
    case 'pie':
      return E.donutChart(ctx, items, { thickness: p.block === 'pie' ? 100 : p.thickness, center: p.block === 'pie' ? '' : p.center, legend: p.legend, gapDeg: p.block === 'pie' ? 1 : 2 });
    case 'progress':
      return E.progressBars(ctx, items, { suffix: p.suffix, thickness: p.thickness });
    case 'rings':
      return E.progressRings(ctx, items, { suffix: p.suffix, thickness: p.thickness });
    case 'steps':
      return E.processSteps(ctx, items, { badge: p.badge, numbered: p.numbered, icons: p.icons && !p.numbered });
    case 'timelineV':
    case 'timelineH':
      return E.timeline(ctx, items, { orientation: p.block === 'timelineV' ? 'vertical' : 'horizontal' });
    case 'comparison':
      return E.comparison(ctx, parseRows(p.data), { titleA: p.titleA, titleB: p.titleB, suffix: p.suffix });
    case 'pictogram':
      return E.pictogram(ctx, { value: items[0]?.value ?? 7, total: p.total, icon: p.icon, perRow: p.perRow, caption: p.caption });
    case 'iconList':
      return E.iconList(ctx, items, { icons: p.icons });
    case 'header':
      return E.sectionHeader(ctx, { title: p.title, subtitle: p.subtitle, kicker: p.kicker });
  }
}

export const infoBlock: DocumentCommand<InfoParams> = {
  kind: 'document',
  id: 'info.block',
  title: 'Add Infographic Block',
  category: 'info',
  view: 'info',
  supportsPreview: true,
  keywords: ['infographic', 'chart', 'donut', 'pie', 'bar', 'stats', 'numbers', 'timeline', 'steps', 'process', 'إنفوجرافيك', 'رسم بياني', 'إحصاء'],
  description: 'Build an editable infographic block (stat cards, charts, steps, timeline…) from your data — Arabic RTL ready.',
  defaultParams: ({ settings }) => defaultInfoParams('statCards', settings),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (p.fitSelection && subjectItems(snapshot).length === 0) return 'Select a placeholder shape to fit (or turn “Fit selection” off).';
    if (p.block !== 'header' && p.block !== 'pictogram' && E.parseInfoData(p.data).length === 0) return 'Add at least one line of data (label | value).';
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
    const sel = p.fitSelection ? selectionRect(ctx.snapshot, ctx.settings) : null;
    const box = sel ?? infoBox(p.block, ab.rect);
    const tx = ctx.host.begin('Infographic');
    const first = subjectItems(ctx.snapshot)[0];
    let into: Place;
    if (p.fitSelection && first) into = { k: 'above', ref: first.ref };
    else {
      if (!ctx.snapshot.doc!.layers.some((l) => l.name === 'INFOGRAPHIC')) tx.layers.ensure('INFOGRAPHIC', { anchor: 'top' });
      into = { k: 'layer', name: 'INFOGRAPHIC', at: 'top' };
    }
    const res = planInfo(ctx.settings, p, box, tx, into);
    return { batch: tx.toBatch(), summary: res.summary, warnings: [] };
  },
};

/** Palette shortcuts: one command per block with its sample data. */
export const INFO_SHORTCUTS: DocumentCommand<InfoParams>[] = E.INFO_BLOCKS.map((b) => ({
  ...infoBlock,
  id: `info.${b.id}`,
  title: `Infographic: ${b.name}`,
  keywords: [...infoBlock.keywords, b.name.toLowerCase()],
  description: `Add a ${b.name.toLowerCase()} block (edit the data in the Infographic tab).`,
  defaultParams: ({ settings }) => defaultInfoParams(b.id, settings),
}));

export const INFO_COMMANDS = [infoBlock, ...INFO_SHORTCUTS];
