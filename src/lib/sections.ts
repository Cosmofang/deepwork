export interface SectionDefinition {
  name: string;
  hint: string;
}

export const DEFAULT_SECTION = '整体';

export const DEFAULT_SECTIONS: SectionDefinition[] = [
  { name: DEFAULT_SECTION, hint: '整体方向、语气与共识' },
  { name: '首屏', hint: 'Hero、第一屏与视觉焦点' },
  { name: '价值主张', hint: '核心卖点、标题与解释' },
  { name: '功能亮点', hint: '能力、模块与功能展示' },
  { name: '定价', hint: '套餐、价格与购买路径' },
  { name: 'FAQ', hint: '疑虑处理与常见问题' },
  { name: '社交证明', hint: '评价、案例与背书' },
  { name: 'CTA', hint: '行动按钮与转化收口' },
  { name: '企业介绍', hint: '公司故事、团队、使命与品牌背书' },
];

export function normalizeSectionName(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || DEFAULT_SECTION;
}
