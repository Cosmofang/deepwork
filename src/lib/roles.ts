import { RoleId } from '@/types';

export const ROLES: Record<RoleId, {
  label: string;
  color: string;
  typical: string;
  demoIntents: { section: string; content: string }[];
}> = {
  designer: {
    label: '设计师',
    color: '#A855F7',
    typical: '首屏要有视觉冲击，风格偏冷色',
    demoIntents: [
      { section: '首屏', content: '首屏背景用深色渐变（#0a0a0a→#1a1a2e），主视觉是动态粒子或光晕效果，整体冷峻现代感' },
      { section: '功能亮点', content: '功能模块用卡片布局，边框用 1px 半透明白色，悬停有微光效果，排版要留白充足' },
    ],
  },
  copywriter: {
    label: '文案',
    color: '#3B82F6',
    typical: '标题要简洁有力，突出核心价值',
    demoIntents: [
      { section: '首屏', content: '主标题：「让每一个想法，都有它该在的位置」，副标题：「多角色协同，AI 合成共识，实时看见彼此的贡献」' },
      { section: 'CTA', content: 'CTA 按钮文案用「开始一次合成」而不是「免费试用」，突出产品核心动作而非价格' },
    ],
  },
  developer: {
    label: '程序员',
    color: '#22C55E',
    typical: '要有 API 文档入口，技术参数清晰',
    demoIntents: [
      { section: '功能亮点', content: '需要一个「技术架构」区块：Supabase Realtime 驱动实时协作，Claude claude-opus-4-7 负责合成，延迟 <2s' },
      { section: 'FAQ', content: 'FAQ 里必须回答「数据安全吗？」和「支持多少人同时在线？」这两个问题' },
    ],
  },
  product: {
    label: '产品',
    color: '#F97316',
    typical: '定价方案突出，FAQ 解答常见疑虑',
    demoIntents: [
      { section: '定价', content: '定价分三档：Free（3人房间）/ Pro（10人，¥99/月）/ Team（无限，¥499/月），突出 Pro 方案' },
      { section: '价值主张', content: '核心价值主张是「从意图到产物，跳过所有争论」，解决的痛点是多人协作时谁都不满意的那个最终版本' },
    ],
  },
  marketing: {
    label: '市场',
    color: '#EC4899',
    typical: '放用户评价，社交证明要强',
    demoIntents: [
      { section: '社交证明', content: '放三个用户评价：设计师说"第一次觉得自己的想法真的被实现了"，产品说"开会时间减少了 80%"，CEO说"团队共识达成快了3倍"' },
      { section: '首屏', content: '首屏加一行数字：「已有 2,000+ 团队在使用」，增加可信度和紧迫感' },
    ],
  },
  employee: {
    label: '普通员工',
    color: '#6B7280',
    typical: '整体要看起来专业可信',
    demoIntents: [
      { section: '整体', content: '页面整体要看起来像一个正规公司的产品，logo 要有，底部要有版权信息和隐私政策链接' },
      { section: 'FAQ', content: '我最想知道怎么开始用，FAQ 里加一条「如何快速上手」，最好有3步流程说明' },
    ],
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
