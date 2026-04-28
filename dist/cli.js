#!/usr/bin/env node
/**
 * DeepLoop CLI
 *
 * Usage:
 *   deeploop connect <PROJECT_CODE> [--name <agent>] [--url <base>]
 *   deeploop brief     [--project <code>]
 *   deeploop ls        [--project <code>]
 *   deeploop get <id>  [--project <code>]
 *   deeploop next      [--project <code>]
 *   deeploop log       [--limit <n>] [--project <code>]
 *   deeploop push "<content>" [--priority normal|important|urgent] [--project <code>]
 *   deeploop result    --req <id> --summary "<text>" [--html <file>] [--project <code>]
 *   deeploop current   [--out <file>] [--project <code>]
 *   deeploop status    [--project <code>]
 *   deeploop work      [--project <code>]
 *   deeploop config
 *   deeploop disconnect [<PROJECT_CODE>]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { exec } from 'child_process';
function openBrowser(url) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
    exec(cmd, () => { });
}
// ── config ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(os.homedir(), '.deeploop', 'config.json');
function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
    catch {
        return { projects: {} };
    }
}
function saveConfig(cfg) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
function getProject(cfg, code) {
    const key = (code ?? cfg.current ?? '').toUpperCase();
    const proj = cfg.projects[key];
    if (!proj) {
        die(`未找到项目 ${key || '(未指定)'}，请先运行: deeploop connect <PROJECT_CODE>`);
    }
    return proj;
}
// ── arg parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const positional = [];
    const flags = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                flags[key] = next;
                i += 2;
            }
            else {
                flags[key] = 'true';
                i++;
            }
        }
        else {
            positional.push(a);
            i++;
        }
    }
    return { positional, flags };
}
// ── http helpers ──────────────────────────────────────────────────────────────
async function api(base, endpoint, options = {}) {
    const url = base.replace(/\/$/, '') + endpoint;
    const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return data;
}
// ── output helpers ────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    purple: '\x1b[35m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
};
function print(msg) { process.stdout.write(msg + '\n'); }
function die(msg) { process.stderr.write(`${C.red}✗ ${msg}${C.reset}\n`); process.exit(1); }
function ok(msg) { print(`${C.green}✓${C.reset} ${msg}`); }
function info(msg) { print(`${C.gray}  ${msg}${C.reset}`); }
function header(msg) { print(`\n${C.bold}${C.cyan}${msg}${C.reset}`); }
function section(msg) { print(`\n${C.bold}${msg}${C.reset}`); }
function rule() { print(`${C.gray}${'─'.repeat(56)}${C.reset}`); }
function priorityColor(p) {
    if (p === 'urgent')
        return `${C.red}紧急${C.reset}`;
    if (p === 'important')
        return `${C.yellow}重要${C.reset}`;
    return `${C.gray}普通${C.reset}`;
}
function priorityBadge(p) {
    if (p === 'urgent')
        return `${C.red}[紧急]${C.reset}`;
    if (p === 'important')
        return `${C.yellow}[重要]${C.reset}`;
    return `${C.gray}[普通]${C.reset}`;
}
// ── commands ──────────────────────────────────────────────────────────────────
async function cmdConnect(positional, flags) {
    const code = (positional[0] ?? flags['project'] ?? '').toUpperCase();
    if (!code)
        die('用法: deeploop connect <PROJECT_CODE> [--name <agent>] [--url <base>]');
    const baseUrl = flags['url'] ?? 'http://localhost:3000';
    const agentName = flags['name'] ?? os.hostname();
    print(`${C.purple}DeepLoop${C.reset} 正在连接项目 ${C.bold}${code}${C.reset} (${baseUrl})…`);
    // Register the agent identity (mode='agent' only inserts an employee
    // participant — no panelParticipantId is returned).
    const agentJoin = await api(baseUrl, '/api/projects/join', {
        method: 'POST',
        body: { projectCode: code, name: agentName, mode: 'agent', roleDescription: 'CLI Agent' },
    });
    // Also register a panel participant so `deeploop push` can post requirements
    // as a panel user (panel participants are the canonical "requirement
    // posters"). Best-effort: if it fails, push will fall back to using the
    // agentId as the participant.
    let panelParticipantId;
    try {
        const panelJoin = await api(baseUrl, '/api/projects/join', {
            method: 'POST',
            body: { projectCode: code, name: agentName, mode: 'panel' },
        });
        panelParticipantId = panelJoin.panelParticipantId;
    }
    catch {
        // Panel join is optional — push will use agentId as fallback
    }
    // Best-effort fetch of Supabase config so `deeploop work` can use Realtime push
    // instead of HTTP polling. If the panel doesn't expose the endpoint or the
    // env vars are missing, work falls back to the legacy 5 s poll.
    let supabaseUrl;
    let supabaseAnonKey;
    try {
        const conn = await api(baseUrl, '/api/connection-info');
        supabaseUrl = conn.supabaseUrl;
        supabaseAnonKey = conn.supabaseAnonKey;
    }
    catch {
        // panel might be older than this CLI; leave fields undefined and warn later in `work`
    }
    const cfg = loadConfig();
    cfg.current = code;
    cfg.projects[code] = {
        url: baseUrl,
        projectCode: code,
        agentId: agentJoin.agentId,
        panelParticipantId: panelParticipantId ?? '',
        agentName,
        supabaseUrl,
        supabaseAnonKey,
    };
    saveConfig(cfg);
    ok(`已连接项目 ${C.bold}${code}${C.reset} · agent: ${C.purple}${agentName}${C.reset}`);
    info(`agentId:            ${agentJoin.agentId}`);
    if (panelParticipantId)
        info(`panelParticipantId: ${panelParticipantId}`);
    info(`config:             ${CONFIG_PATH}`);
    print('');
    const panelUrl = `${baseUrl}/project/${code}`;
    print(`${C.purple}▶ 正在打开面板：${C.reset} ${panelUrl}`);
    openBrowser(panelUrl);
    print('');
    print(`${C.yellow}注意：deeploop connect 只把当前 Agent 接入任务面板。${C.reset}`);
    print(`${C.yellow}Agent 应在目标项目目录中工作，用 deeploop push/result/work 同步需求和结果；不要把面板服务所在的 DeepLoop 仓库当成要修改的目标项目。${C.reset}`);
    print('');
    print(`${C.dim}下一步: deeploop brief${C.reset}`);
}
// ── brief ─────────────────────────────────────────────────────────────────────
async function cmdBrief(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const [reqData, subData] = await Promise.all([
        api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
        api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
    ]);
    const reqs = reqData.requirements ?? [];
    const subs = subData.submissions ?? [];
    const done = new Set(subs.filter(s => s.agent_id === proj.agentId).map(s => s.requirement_id));
    const WEIGHT = { urgent: 100, important: 75, normal: 50 };
    const pending = reqs
        .filter(r => !done.has(r.id))
        .sort((a, b) => (WEIGHT[b.priority] ?? 50) - (WEIGHT[a.priority] ?? 50));
    const byPriority = { urgent: 0, important: 0, normal: 0 };
    for (const r of reqs) {
        const k = r.priority;
        byPriority[k] = (byPriority[k] ?? 0) + 1;
    }
    // ── header ──
    print('');
    print(`${C.bold}${C.purple}DeepLoop 项目简报${C.reset}  ${C.gray}${proj.projectCode} · ${proj.url}${C.reset}`);
    print(`${C.gray}Agent: ${proj.agentName}  (${proj.agentId.slice(0, 8)}…)${C.reset}`);
    rule();
    // ── stats ──
    section('📊 需求统计');
    print(`  总需求 ${C.bold}${reqs.length}${C.reset}   已提交 ${C.bold}${subs.length}${C.reset}   我的待处理 ${pending.length > 0 ? C.yellow + pending.length + C.reset : C.green + '0' + C.reset}`);
    const parts = [];
    if (byPriority.urgent)
        parts.push(`${C.red}紧急 ${byPriority.urgent}${C.reset}`);
    if (byPriority.important)
        parts.push(`${C.yellow}重要 ${byPriority.important}${C.reset}`);
    if (byPriority.normal)
        parts.push(`${C.gray}普通 ${byPriority.normal}${C.reset}`);
    if (parts.length)
        print(`  ${parts.join('  ')}`);
    // ── recent submissions from others ──
    const recentSubs = subs.filter(s => s.summary).slice(0, 6);
    if (recentSubs.length > 0) {
        section('✅ 近期交付  (其他 Agent 已做的工作)');
        for (const s of recentSubs) {
            const agentTag = `${C.purple}${(s.agent?.name ?? '?').slice(0, 16)}${C.reset}`;
            const reqSnip = reqs.find(r => r.id === s.requirement_id)?.content.slice(0, 30) ?? s.requirement_id.slice(0, 8);
            print(`  ${C.dim}${s.id.slice(0, 8)}${C.reset}  ${agentTag}  ${C.dim}→${C.reset} ${s.summary.slice(0, 60)}`);
            info(`           需求: ${reqSnip}  ·  ${elapsed(s.created_at)}`);
        }
    }
    // ── pending queue ──
    if (pending.length > 0) {
        section(`⏳ 待处理队列  (${pending.length} 条，按优先级排序)`);
        for (const r of pending.slice(0, 5)) {
            print(`  ${C.dim}${r.id.slice(0, 8)}${C.reset}  ${priorityBadge(r.priority)}  ${r.content.slice(0, 72)}`);
        }
        if (pending.length > 5)
            info(`  …另有 ${pending.length - 5} 条`);
    }
    else {
        print(`\n  ${C.green}✓ 所有需求均已处理${C.reset}`);
    }
    // ── output spec ──
    rule();
    section('📋 输出规范');
    print(`  格式  完整 <!DOCTYPE html> 文件，无外部 CDN`);
    print(`  风格  深色 SaaS (#080808 背景，#a855f7 强调色，#3b82f6 辅色)`);
    print(`  必须  ① Hero 光晕动画  ② scroll-reveal  ③ 数字计数  ④ 卡片 hover`);
    print(`  结构  Header → Hero → 价值主张 → 功能 → 口碑 → 定价 → FAQ → CTA → Footer`);
    print(`  文案  全部中文，产品名从需求中提取`);
    // ── next action ──
    rule();
    if (pending.length > 0) {
        const next = pending[0];
        section('→ 立即开始');
        print(`  ${C.bold}deeploop get ${next.id.slice(0, 8)}${C.reset}   # 查看完整需求`);
        print(`  ${C.dim}deeploop result --req ${next.id} --summary "摘要" --html out.html${C.reset}`);
    }
    else {
        section('→ 等待新需求');
        print(`  ${C.dim}deeploop work   # 启动轮询，自动处理新需求${C.reset}`);
    }
    print('');
}
// ── ls ────────────────────────────────────────────────────────────────────────
async function cmdLs(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const [reqData, subData] = await Promise.all([
        api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
        api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
    ]);
    const reqs = reqData.requirements ?? [];
    const subs = subData.submissions ?? [];
    if (reqs.length === 0) {
        print(`${C.gray}暂无需求${C.reset}`);
        return;
    }
    const subCount = (id) => subs.filter(s => s.requirement_id === id).length;
    const myDone = new Set(subs.filter(s => s.agent_id === proj.agentId).map(s => s.requirement_id));
    header(`项目 ${proj.projectCode} · ${reqs.length} 条需求`);
    for (const r of reqs) {
        const n = subCount(r.id);
        const done = myDone.has(r.id);
        const mark = done ? `${C.green}✓${C.reset}` : `${C.gray}·${C.reset}`;
        const subs_label = n > 0 ? `${C.green}${n} 份成品${C.reset}` : `${C.gray}待处理${C.reset}`;
        const snip = r.content.length > 56 ? r.content.slice(0, 56).replace(/\n/g, ' ') + '…' : r.content.replace(/\n/g, ' ');
        print(`  ${mark} ${C.dim}${r.id.slice(0, 8)}${C.reset}  ${priorityBadge(r.priority)}  ${snip}  ${subs_label}  ${C.gray}${elapsed(r.created_at)}${C.reset}`);
    }
}
// ── get ───────────────────────────────────────────────────────────────────────
async function cmdGet(positional, flags) {
    const partial = positional[0] ?? flags['req'];
    if (!partial)
        die('用法: deeploop get <requirement-id>');
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const [reqData, subData] = await Promise.all([
        api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
        api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
    ]);
    const req = (reqData.requirements ?? []).find(r => r.id === partial || r.id.startsWith(partial));
    if (!req)
        die(`需求 "${partial}" 不存在`);
    const reqSubs = (subData.submissions ?? []).filter(s => s.requirement_id === req.id);
    const myDone = reqSubs.some(s => s.agent_id === proj.agentId);
    header('需求详情');
    print(`  ${C.bold}ID:${C.reset}       ${req.id}`);
    print(`  ${C.bold}优先级:${C.reset}   ${priorityColor(req.priority)}`);
    print(`  ${C.bold}发布:${C.reset}     ${elapsed(req.created_at)}`);
    print(`  ${C.bold}提交数:${C.reset}   ${reqSubs.length} 份${myDone ? `  ${C.green}(我已提交)${C.reset}` : ''}`);
    rule();
    print('');
    print(req.content);
    print('');
    if (reqSubs.length > 0) {
        rule();
        print(`${C.bold}已有提交:${C.reset}`);
        for (const s of reqSubs) {
            const isMe = s.agent_id === proj.agentId;
            print(`  ${C.dim}${s.id.slice(0, 8)}${C.reset}  ${isMe ? C.green : C.purple}${s.agent?.name ?? '?'}${isMe ? ' (我)' : ''}${C.reset}  ${s.summary.slice(0, 64)}  ${C.gray}${elapsed(s.created_at)}${C.reset}`);
        }
        print('');
    }
    if (!myDone) {
        print(`${C.dim}提交: deeploop result --req ${req.id} --summary "摘要" --html out.html${C.reset}`);
    }
}
// ── next ──────────────────────────────────────────────────────────────────────
async function cmdNext(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const [reqData, subData] = await Promise.all([
        api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
        api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
    ]);
    const done = new Set((subData.submissions ?? [])
        .filter(s => s.agent_id === proj.agentId)
        .map(s => s.requirement_id));
    const WEIGHT = { urgent: 100, important: 75, normal: 50 };
    const pending = (reqData.requirements ?? [])
        .filter(r => !done.has(r.id))
        .sort((a, b) => (WEIGHT[b.priority] ?? 50) - (WEIGHT[a.priority] ?? 50));
    if (pending.length === 0) {
        print(`${C.green}✓ 没有待处理需求${C.reset}`);
        return;
    }
    const next = pending[0];
    header('下一条需求');
    print(`  ${C.bold}ID:${C.reset}       ${next.id}`);
    print(`  ${C.bold}优先级:${C.reset}   ${priorityColor(next.priority)}`);
    print(`  ${C.bold}发布:${C.reset}     ${elapsed(next.created_at)}`);
    rule();
    print('');
    print(next.content);
    print('');
    rule();
    print(`${C.dim}提交: deeploop result --req ${next.id} --summary "摘要" --html out.html${C.reset}`);
    if (pending.length > 1) {
        info(`另有 ${pending.length - 1} 条待处理需求`);
    }
}
// ── log ───────────────────────────────────────────────────────────────────────
async function cmdLog(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const limit = Math.min(parseInt(flags['limit'] ?? '15', 10), 50);
    const [reqData, subData] = await Promise.all([
        api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
        api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
    ]);
    const reqMap = new Map((reqData.requirements ?? []).map(r => [r.id, r]));
    const subs = (subData.submissions ?? []).slice(0, limit);
    if (subs.length === 0) {
        print(`${C.gray}暂无提交记录${C.reset}`);
        return;
    }
    header(`提交记录 · 最近 ${subs.length} 条`);
    for (const s of subs) {
        const req = reqMap.get(s.requirement_id);
        const isMe = s.agent_id === proj.agentId;
        const name = s.agent?.name ?? '?';
        const reqSnip = req ? req.content.slice(0, 36).replace(/\n/g, ' ') : s.requirement_id.slice(0, 8);
        print(`  ${C.dim}${s.id.slice(0, 8)}${C.reset}  ${isMe ? C.green : C.purple}${name}${isMe ? ` (我)` : ''}${C.reset}  ${C.dim}→${C.reset} ${reqSnip}`);
        if (s.summary)
            info(`           ${s.summary.slice(0, 72)}`);
        info(`           ${elapsed(s.created_at)}`);
    }
}
// ── push ──────────────────────────────────────────────────────────────────────
async function cmdPush(positional, flags) {
    const content = positional[0];
    if (!content)
        die('用法: deeploop push "<需求内容>" [--priority normal|important|urgent]');
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const priority = (['normal', 'important', 'urgent'].includes(flags['priority'] ?? ''))
        ? flags['priority']
        : 'normal';
    // Prefer the panel participant id (set by recent connect), fall back to the
    // agent id for older configs. The /api/requirements POST handler accepts any
    // project member as the poster — it just verifies room membership.
    const participantId = proj.panelParticipantId || proj.agentId;
    if (!participantId) {
        die('当前 config 没有任何 participantId。请运行 deeploop connect <PROJECT_CODE> 重新接入。');
    }
    const data = await api(proj.url, '/api/requirements', {
        method: 'POST',
        body: {
            projectId: proj.projectCode,
            content,
            participantId,
            priority,
        },
    });
    ok(`需求已发布`);
    info(`requirementId: ${data.requirement.id}`);
    info(`优先级: ${priority}`);
}
// ── result ────────────────────────────────────────────────────────────────────
async function cmdResult(flags) {
    const reqId = flags['req'];
    const summary = flags['summary'] ?? '';
    const htmlFile = flags['html'];
    if (!reqId)
        die('用法: deeploop result --req <id> --summary "<描述>" [--html <文件>]');
    let html = flags['html-inline'] ?? '';
    if (htmlFile) {
        if (!fs.existsSync(htmlFile))
            die(`文件不存在: ${htmlFile}`);
        html = fs.readFileSync(htmlFile, 'utf-8');
    }
    if (!html)
        html = await readStdin();
    if (!html.trim())
        die('需要提供 HTML 内容（--html <文件> 或通过 stdin 传入）');
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    print(`提交结果 (${html.length.toLocaleString()} chars)…`);
    const data = await api(proj.url, '/api/submit-result', {
        method: 'POST',
        body: {
            projectId: proj.projectCode,
            requirementId: reqId,
            agentId: proj.agentId,
            html,
            summary,
        },
    });
    ok(`提交成功`);
    info(`submissionId: ${data.submissionId}`);
}
// ── status ────────────────────────────────────────────────────────────────────
async function cmdStatus(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const [reqData, subData] = await Promise.all([
        api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
        api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
    ]);
    const reqs = reqData.requirements ?? [];
    const subs = subData.submissions ?? [];
    const myDone = subs.filter(s => s.agent_id === proj.agentId).length;
    const pending = reqs.filter(r => !subs.some(s => s.requirement_id === r.id && s.agent_id === proj.agentId));
    header(`项目 ${proj.projectCode} 状态`);
    print(`  ${C.bold}URL:${C.reset}        ${proj.url}`);
    print(`  ${C.bold}Agent:${C.reset}      ${proj.agentName}`);
    print(`  ${C.bold}Agent ID:${C.reset}   ${proj.agentId}`);
    print(`  ${C.bold}需求总数:${C.reset}   ${reqs.length}`);
    print(`  ${C.bold}提交总数:${C.reset}   ${subs.length}`);
    print(`  ${C.bold}我的提交:${C.reset}   ${myDone}`);
    print(`  ${C.bold}待处理:${C.reset}     ${pending.length > 0 ? C.yellow + pending.length + C.reset : C.green + '0 (全部完成)' + C.reset}`);
}
// ── work ──────────────────────────────────────────────────────────────────────
// section codes that count as a real, confirmed requirement (not pending suggestion)
const REQ_SECTIONS = ['__REQ__', '__REQ_H__', '__REQ_U__'];
const SECTION_TO_PRIORITY = {
    __REQ__: 'normal',
    __REQ_H__: 'important',
    __REQ_U__: 'urgent',
};
async function cmdWork(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    // Detect whether we have Supabase credentials for Realtime push, or fall back to poll.
    const hasRealtime = Boolean(proj.supabaseUrl && proj.supabaseAnonKey);
    print(`${C.purple}DeepLoop Worker${C.reset}  project=${C.bold}${proj.projectCode}${C.reset}  agent=${proj.agentName}`);
    if (hasRealtime) {
        print(`${C.dim}Realtime 推送模式（即时响应新需求），Ctrl+C 退出${C.reset}`);
    }
    else {
        print(`${C.dim}轮询模式（每 5 秒），Ctrl+C 退出${C.reset}`);
        print(`${C.yellow}提示：当前 config 缺少 Supabase 配置，可重新运行 deeploop connect <project> 升级到 Realtime 模式${C.reset}`);
    }
    print('');
    // Coordinated state shared by realtime + initial backlog scan
    const processed = new Set();
    const inflight = new Set();
    const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const ping = (requirementId, phase) => api(proj.url, '/api/agent-ping', {
        method: 'POST',
        body: { projectId: proj.projectCode, agentId: proj.agentId, agentName: proj.agentName, requirementId, phase },
    }).catch(() => { });
    const handleRequirement = async (req) => {
        if (processed.has(req.id) || inflight.has(req.id))
            return;
        inflight.add(req.id);
        processed.add(req.id);
        print(`${C.gray}[${ts()}]${C.reset} ${C.yellow}→${C.reset} ${req.id.slice(0, 8)}  ${priorityBadge(req.priority)}  ${req.content.slice(0, 64).replace(/\n/g, ' ')}`);
        void ping(req.id, 'picked');
        try {
            const res = await api(proj.url, '/api/generate', {
                method: 'POST',
                body: { projectId: proj.projectCode, requirementId: req.id, agentId: proj.agentId },
            });
            void ping(req.id, 'done');
            print(`${C.gray}[${ts()}]${C.reset} ${C.green}✓${C.reset} submissionId=${res.submission?.id ?? '?'}`);
        }
        catch (e) {
            process.stderr.write(`${C.gray}[${ts()}]${C.reset} ${C.red}✗ 生成失败: ${e.message}${C.reset}\n`);
        }
        finally {
            inflight.delete(req.id);
        }
    };
    // ── initial backlog scan via HTTP (works in both modes) ──────────────────
    const scanBacklog = async () => {
        const [reqData, subData] = await Promise.all([
            api(proj.url, `/api/requirements?projectId=${proj.projectCode}`),
            api(proj.url, `/api/submissions?projectId=${proj.projectCode}&lite=1`),
        ]);
        const done = new Set((subData.submissions ?? [])
            .filter(s => s.agent_id === proj.agentId)
            .map(s => s.requirement_id));
        const WEIGHT = { urgent: 100, important: 75, normal: 50 };
        const pending = (reqData.requirements ?? [])
            .filter(r => !done.has(r.id) && !processed.has(r.id) && !r.pending)
            .sort((a, b) => (WEIGHT[b.priority] ?? 50) - (WEIGHT[a.priority] ?? 50));
        for (const req of pending) {
            // Sequential so we don't generate ten things in parallel; matches old poll behavior
            await handleRequirement({ id: req.id, content: req.content, priority: req.priority });
        }
    };
    await scanBacklog();
    // ── realtime path: subscribe directly to Supabase postgres_changes ───────
    if (hasRealtime) {
        let unsubscribe = () => { };
        try {
            // Dynamic import keeps the module out of the import graph for users who
            // run the CLI from an old config without supabase creds (still works in
            // poll mode).
            const { createClient } = await import('@supabase/supabase-js');
            const supabase = createClient(proj.supabaseUrl, proj.supabaseAnonKey, {
                realtime: { params: { eventsPerSecond: 10 } },
            });
            const channel = supabase
                .channel(`cli-worker-${proj.projectCode}-${proj.agentId.slice(0, 8)}`)
                .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'intents',
                filter: `room_id=eq.${proj.projectCode}`,
            }, (payload) => {
                const row = payload.new;
                const section = String(row.section ?? '');
                if (!REQ_SECTIONS.includes(section))
                    return;
                const id = String(row.id ?? '');
                const content = String(row.content ?? '');
                if (!id || !content)
                    return;
                void handleRequirement({
                    id,
                    content,
                    priority: SECTION_TO_PRIORITY[section] ?? 'normal',
                });
            })
                .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    print(`${C.gray}[${ts()}]${C.reset} ${C.green}●${C.reset} realtime 已连接，监听 ${proj.projectCode} 新需求…`);
                }
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    process.stderr.write(`${C.gray}[${ts()}]${C.reset} ${C.red}realtime 状态: ${status}${C.reset}\n`);
                }
            });
            unsubscribe = () => { void channel.unsubscribe(); void supabase.removeAllChannels(); };
        }
        catch (e) {
            process.stderr.write(`${C.red}realtime 订阅失败：${e.message}${C.reset}\n`);
            process.stderr.write(`${C.yellow}降级为轮询模式${C.reset}\n\n`);
            // Fall through to poll loop below
        }
        if (unsubscribe !== (() => { })) {
            process.on('SIGINT', () => { unsubscribe(); print('\n已退出'); process.exit(0); });
            process.on('SIGTERM', () => { unsubscribe(); process.exit(0); });
            await new Promise(() => { });
            return;
        }
    }
    // ── fallback: legacy 5 s poll ────────────────────────────────────────────
    const t = setInterval(() => void scanBacklog().catch(e => {
        process.stderr.write(`${C.gray}[${ts()}]${C.reset} ${C.red}poll error: ${e.message}${C.reset}\n`);
    }), 5000);
    process.on('SIGINT', () => { clearInterval(t); print('\n已退出'); process.exit(0); });
    process.on('SIGTERM', () => { clearInterval(t); process.exit(0); });
    await new Promise(() => { });
}
// ── config ────────────────────────────────────────────────────────────────────
function cmdConfig() {
    const cfg = loadConfig();
    const keys = Object.keys(cfg.projects);
    header('DeepLoop 配置');
    print(`  ${C.bold}配置文件:${C.reset} ${CONFIG_PATH}`);
    print(`  ${C.bold}当前项目:${C.reset} ${cfg.current ? C.bold + cfg.current + C.reset : C.gray + '(未设置)' + C.reset}`);
    print('');
    if (keys.length === 0) {
        print(`${C.gray}暂无项目，运行: deeploop connect <CODE>${C.reset}`);
        return;
    }
    print(`${C.bold}已连接项目 (${keys.length} 个):${C.reset}`);
    for (const k of keys) {
        const p = cfg.projects[k];
        const isCurrent = k === cfg.current;
        print(`  ${isCurrent ? C.green + '▶' + C.reset : ' '} ${C.bold}${k}${C.reset}  ${C.dim}${p.url}${C.reset}  as ${C.purple}${p.agentName}${C.reset}`);
        info(`    agentId:            ${p.agentId}`);
        info(`    panelParticipantId: ${p.panelParticipantId}`);
    }
}
// ── disconnect ────────────────────────────────────────────────────────────────
function cmdDisconnect(positional, flags) {
    const code = (positional[0] ?? flags['project'] ?? '').toUpperCase();
    const cfg = loadConfig();
    const target = code || cfg.current;
    if (!target)
        die('没有当前项目，请指定: deeploop disconnect <CODE>');
    const key = target.toUpperCase();
    if (!cfg.projects[key])
        die(`项目 ${key} 不存在`);
    delete cfg.projects[key];
    if (cfg.current === key) {
        cfg.current = Object.keys(cfg.projects)[0];
    }
    saveConfig(cfg);
    ok(`已断开项目 ${key}`);
    if (cfg.current)
        info(`当前项目切换为: ${cfg.current}`);
}
// ── current ───────────────────────────────────────────────────────────────────
async function cmdCurrent(flags) {
    const cfg = loadConfig();
    const proj = getProject(cfg, flags['project']);
    const outFile = flags['out'] ?? flags['o'];
    const data = await api(proj.url, `/api/current-page?projectId=${proj.projectCode}`);
    if (!data.current) {
        print(`${C.gray}暂无版本${C.reset}`);
        return;
    }
    const { html, summary, versionNumber, agentName, createdAt } = data.current;
    if (outFile) {
        fs.writeFileSync(outFile, html, 'utf-8');
        ok(`已保存当前页面 (v${versionNumber}) → ${outFile}`);
        info(`摘要: ${summary}`);
        info(`来自: ${agentName}  ·  ${elapsed(createdAt)}`);
        info(`共 ${data.versionCount} 个历史版本`);
    }
    else {
        process.stdout.write(html);
    }
}
// ── helpers ───────────────────────────────────────────────────────────────────
function elapsed(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60)
        return `${s}s ago`;
    if (s < 3600)
        return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}
function readStdin() {
    return new Promise(resolve => {
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        let buf = '';
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', l => { buf += l + '\n'; });
        rl.on('close', () => resolve(buf));
    });
}
// ── help ──────────────────────────────────────────────────────────────────────
function printHelp() {
    print(`
${C.bold}${C.purple}DeepLoop CLI${C.reset}  Agent 工作面板连接工具

${C.bold}连接与配置:${C.reset}
  deeploop connect <CODE>  [--name <名称>] [--url <地址>]   连接项目
  deeploop config                                           查看所有已连接项目
  deeploop disconnect      [<CODE>]                         断开项目

${C.bold}上下文与任务:${C.reset}
  deeploop brief           [--project <code>]               项目完整简报（推荐首先运行）
  deeploop ls              [--project <code>]               需求列表（含提交数）
  deeploop get  <id>       [--project <code>]               查看需求完整内容
  deeploop next            [--project <code>]               取下一条待处理需求
  deeploop log             [--limit <n>] [--project <code>] 近期提交记录

${C.bold}操作:${C.reset}
  deeploop push "<内容>"   [--priority normal|important|urgent]  发布需求
  deeploop result          --req <id> --summary "<描述>" [--html <文件>]  提交结果
  deeploop current         [--out <文件>] [--project <code>]   查看/导出当前最新页面
  deeploop status          [--project <code>]               项目状态
  deeploop work            [--project <code>]               自动 worker（轮询模式）

${C.bold}典型工作流（OpenClaw / Claude Code 接入）:${C.reset}
  ${C.dim}deeploop connect QQAM3Y --name openclaw --url http://localhost:3002
  deeploop brief                   # 了解项目全貌
  deeploop next                    # 取任务
  deeploop get <id>                # 查看完整需求
  # ... 生成 out.html ...
  deeploop result --req <id> --summary "WriteFlow 落地页" --html out.html
  deeploop log                     # 确认提交${C.reset}
`);
}
// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        return;
    }
    const { positional, flags } = parseArgs(args);
    const cmd = positional[0];
    const rest = positional.slice(1);
    try {
        if (cmd === 'connect')
            await cmdConnect(rest, flags);
        else if (cmd === 'brief')
            await cmdBrief(flags);
        else if (cmd === 'ls' || cmd === 'list')
            await cmdLs(flags);
        else if (cmd === 'get')
            await cmdGet(rest, flags);
        else if (cmd === 'next')
            await cmdNext(flags);
        else if (cmd === 'log')
            await cmdLog(flags);
        else if (cmd === 'push')
            await cmdPush(rest, flags);
        else if (cmd === 'result' || cmd === 'submit')
            await cmdResult(flags);
        else if (cmd === 'current')
            await cmdCurrent(flags);
        else if (cmd === 'status')
            await cmdStatus(flags);
        else if (cmd === 'work' || cmd === 'worker')
            await cmdWork(flags);
        else if (cmd === 'config')
            cmdConfig();
        else if (cmd === 'disconnect')
            cmdDisconnect(rest, flags);
        else
            die(`未知命令: ${cmd}\n运行 deeploop --help 查看帮助`);
    }
    catch (e) {
        die(e.message);
    }
}
void main();
