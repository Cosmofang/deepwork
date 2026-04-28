import { RoleId } from '@/types';

export const ROLES: Record<RoleId, {
  label: string;
  color: string;
  typical: string;
  demoIntents: { section: string; content: string }[];
  demoIntents2: { section: string; content: string }[];
}> = {
  designer: {
    label: '设计师',
    color: '#A855F7',
    typical: '首屏要有视觉冲击，风格偏冷色',
    demoIntents: [
      { section: '首屏', content: '首屏背景用深色渐变（#0a0a0a→#1a1a2e），主视觉是动态粒子或光晕效果，整体冷峻现代感' },
      { section: '功能亮点', content: '功能模块用卡片布局，边框用 1px 半透明白色，悬停有微光效果，排版要留白充足' },
      { section: '企业介绍', content: '企业介绍用横向时间轴展示发展里程碑，搭配创始团队照片，背景用温暖的低饱和度米色与品牌紫色交替，整体有人文气息' },
    ],
    demoIntents2: [
      { section: '首屏', content: '看了第一版，首屏太冷了——把动态粒子改成缓慢流动的光晕渐变，加入少量深琥珀色暖调，整体感觉从「冷峻」转向「邀请感」' },
      { section: '社交证明', content: '社交证明区块的卡片现在太拥挤，建议改为横向轮播，每张卡片背景用角色主色的极低透明度（5%），让归因色也出现在产物里' },
    ],
  },
  copywriter: {
    label: '文案',
    color: '#3B82F6',
    typical: '标题要简洁有力，突出核心价值',
    demoIntents: [
      { section: '首屏', content: '主标题：「让每一个想法，都有它该在的位置」，副标题：「多角色协同，AI 合成共识，实时看见彼此的贡献」' },
      { section: 'CTA', content: 'CTA 按钮文案用「开始一次合成」而不是「免费试用」，突出产品核心动作而非价格' },
      { section: '企业介绍', content: '企业介绍标题：「我们不只是在做工具，是在重新定义协作」，副文案强调团队来自一线协作困境，用真实故事打动人，文字克制、有温度' },
    ],
    demoIntents2: [
      { section: '价值主张', content: '价值主张的三条支撑文案需要升级：第一条改为「6个角色，1个声音」，第二条「意图即决策，无需争论」，第三条「合成后可溯源，每行文字都有归因」' },
      { section: '首屏', content: '副标题去掉"实时"二字，改为「多角色协同，AI 合成共识，每个贡献都可追溯」，更强调可信度而非速度' },
    ],
  },
  developer: {
    label: '程序员',
    color: '#22C55E',
    typical: '要有 API 文档入口，技术参数清晰',
    demoIntents: [
      { section: '功能亮点', content: '需要一个「技术架构」区块：Supabase Realtime 驱动实时协作，Claude AI 负责多角色意图合成，数据端对端加密传输' },
      { section: 'FAQ', content: 'FAQ 里必须回答「数据安全吗？」和「支持多少人同时在线？」这两个问题' },
      { section: '企业介绍', content: '企业介绍加入「开源承诺」板块：核心协议层开源，GitHub 链接可见；并展示技术栈（Next.js / Supabase / Claude API），吸引开发者社区' },
    ],
    demoIntents2: [
      { section: '功能亮点', content: '「技术架构」区块加入 API / Webhook 集成说明：提供 REST API，支持在合成完成后通过 webhook 推送结果到 Slack / Notion，代码示例参考 Stripe 风格' },
      { section: 'FAQ', content: 'FAQ 加一条「支持自部署吗？」——答案是：企业版支持私有化部署，数据不出企业内网，联系销售获取方案' },
    ],
  },
  product: {
    label: '产品',
    color: '#F97316',
    typical: '定价方案突出，FAQ 解答常见疑虑',
    demoIntents: [
      { section: '定价', content: '定价分三档：Free（3人房间）/ Pro（10人，¥99/月）/ Team（无限，¥499/月），突出 Pro 方案' },
      { section: '价值主张', content: '核心价值主张是「从意图到产物，跳过所有争论」，解决的痛点是多人协作时谁都不满意的那个最终版本' },
      { section: '企业介绍', content: '企业介绍要用数字说话：成立时间、服务团队数、合成次数、平均合成耗时；加入「里程碑」时间轴，数据增强可信度和增长感' },
    ],
    demoIntents2: [
      { section: '定价', content: '定价方案加入年付选项：年付享 8 折优惠，在每个方案下方显示「年付 ¥XX/月，立省 XX%」；Pro 方案右上角加「最受欢迎」角标' },
      { section: 'CTA', content: '页面底部 CTA 区域加一行信任背书：「无需信用卡 · 14天免费试用 · 随时取消」，降低转化摩擦' },
    ],
  },
  marketing: {
    label: '市场',
    color: '#EC4899',
    typical: '放用户评价，社交证明要强',
    demoIntents: [
      { section: '社交证明', content: '放三个用户评价：设计师说"第一次觉得自己的想法真的被实现了"，产品说"开会时间减少了 80%"，CEO说"团队共识达成快了3倍"' },
      { section: '首屏', content: '首屏加一行数字：「已有 2,000+ 团队在使用」，增加可信度和紧迫感' },
      { section: '企业介绍', content: '企业介绍加入「媒体报道」栏：36氪、少数派、产品猎人等 logo 灰白展示；再加「投资方背书」区，强化品牌信任感，让用户放心选择' },
    ],
    demoIntents2: [
      { section: '社交证明', content: '用户评价下方加一排媒体提及 logo bar：36氪、少数派、产品猎人，用低饱和度灰白色显示，配文「媒体报道」——增强第三方背书感' },
      { section: '首屏', content: '「已有 2,000+ 团队在使用」改为「已帮助 2,000+ 团队完成 10,000+ 次合成」，数据更具体，更有说服力' },
    ],
  },
  employee: {
    label: '普通员工',
    color: '#6B7280',
    typical: '整体要看起来专业可信',
    demoIntents: [
      { section: '整体', content: '页面整体要看起来像一个正规公司的产品，logo 要有，底部要有版权信息和隐私政策链接' },
      { section: 'FAQ', content: '我最想知道怎么开始用，FAQ 里加一条「如何快速上手」，最好有3步流程说明' },
      { section: '企业介绍', content: '企业介绍要有公司办公地点、联系邮箱，最好放一张真实的团队合影，显得亲切；底部加「我们在招人」入口，展示公司是在成长的' },
    ],
    demoIntents2: [
      { section: 'FAQ', content: '「如何快速上手」的答案要更具体：步骤一：生成房间码（5秒）→ 步骤二：6人各选角色提交意图（5分钟）→ 步骤三：一键合成，AI 30秒内交付落地页（30秒），每步配一个图标' },
      { section: '整体', content: '整体页面加入无障碍设计：所有图标按钮加 aria-label，颜色对比度符合 WCAG AA 标准，footer 加入联系邮箱 hello@deeploop.ai' },
    ],
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
