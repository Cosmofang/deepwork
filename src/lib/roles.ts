import { RoleId } from '@/types';

export const ROLES: Record<RoleId, {
  label: string;
  color: string;
  typical: string;
}> = {
  designer: {
    label: '设计师',
    color: '#A855F7',
    typical: '首屏要有视觉冲击，风格偏冷色',
  },
  copywriter: {
    label: '文案',
    color: '#3B82F6',
    typical: '标题要简洁有力，突出核心价值',
  },
  developer: {
    label: '程序员',
    color: '#22C55E',
    typical: '要有 API 文档入口，技术参数清晰',
  },
  product: {
    label: '产品',
    color: '#F97316',
    typical: '定价方案突出，FAQ 解答常见疑虑',
  },
  marketing: {
    label: '市场',
    color: '#EC4899',
    typical: '放用户评价，社交证明要强',
  },
  employee: {
    label: '普通员工',
    color: '#6B7280',
    typical: '整体要看起来专业可信',
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
