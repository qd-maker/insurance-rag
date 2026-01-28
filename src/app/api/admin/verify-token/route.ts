import { NextResponse } from 'next/server';

// ========== Rate Limit 配置 ==========
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;  // 5 分钟窗口
const MAX_FAILURES = 5;                       // 最大失败次数
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;  // 锁定 15 分钟

// 内存存储（MVP 阶段足够，生产环境应使用 Redis）
interface RateLimitEntry {
    failures: number;
    firstFailure: number;
    lockedUntil: number | null;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIP(req: Request): string {
    // 优先取 X-Forwarded-For（经过代理）
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    // 次选 X-Real-IP
    const realIP = req.headers.get('x-real-ip');
    if (realIP) {
        return realIP;
    }
    // 默认返回 unknown
    return 'unknown';
}

function isRateLimited(ip: string): { limited: boolean; retryAfter?: number } {
    const entry = rateLimitStore.get(ip);
    if (!entry) return { limited: false };

    const now = Date.now();

    // 检查是否在锁定期内
    if (entry.lockedUntil && now < entry.lockedUntil) {
        const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
        return { limited: true, retryAfter };
    }

    // 锁定期已过，清除记录
    if (entry.lockedUntil && now >= entry.lockedUntil) {
        rateLimitStore.delete(ip);
        return { limited: false };
    }

    // 检查窗口期是否过期
    if (now - entry.firstFailure > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.delete(ip);
        return { limited: false };
    }

    return { limited: false };
}

function recordFailure(ip: string): void {
    const now = Date.now();
    const entry = rateLimitStore.get(ip);

    if (!entry) {
        rateLimitStore.set(ip, {
            failures: 1,
            firstFailure: now,
            lockedUntil: null,
        });
        return;
    }

    // 窗口期已过，重置
    if (now - entry.firstFailure > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(ip, {
            failures: 1,
            firstFailure: now,
            lockedUntil: null,
        });
        return;
    }

    // 增加失败次数
    entry.failures += 1;

    // 达到阈值，锁定
    if (entry.failures >= MAX_FAILURES) {
        entry.lockedUntil = now + LOCKOUT_DURATION_MS;
        console.warn(`[Rate Limit] IP ${ip} locked for 15 minutes after ${entry.failures} failed attempts`);
    }
}

function clearFailures(ip: string): void {
    rateLimitStore.delete(ip);
}

export async function POST(req: Request) {
    const clientIP = getClientIP(req);

    try {
        // 检查是否被限流
        const { limited, retryAfter } = isRateLimited(clientIP);
        if (limited) {
            return NextResponse.json(
                { valid: false, error: '请求过于频繁，请稍后再试', retryAfter },
                {
                    status: 429,
                    headers: { 'Retry-After': String(retryAfter || 900) }
                }
            );
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            recordFailure(clientIP);
            return NextResponse.json({ valid: false, error: '缺少认证信息' }, { status: 401 });
        }

        const token = authHeader.slice(7).trim();
        const adminToken = process.env.ADMIN_TOKEN;

        if (!adminToken) {
            console.error('[verify-token] ADMIN_TOKEN 未配置');
            return NextResponse.json({ valid: false, error: '服务端配置错误' }, { status: 500 });
        }

        if (token !== adminToken) {
            recordFailure(clientIP);
            return NextResponse.json({ valid: false, error: 'Token 无效' }, { status: 401 });
        }

        // 验证成功，清除失败记录
        clearFailures(clientIP);
        return NextResponse.json({ valid: true });
    } catch (e: any) {
        return NextResponse.json({ valid: false, error: e?.message || '验证失败' }, { status: 500 });
    }
}

// 导出用于测试的辅助函数
export function getRateLimitStatus(ip: string): RateLimitEntry | undefined {
    return rateLimitStore.get(ip);
}

export function clearRateLimitStore(): void {
    rateLimitStore.clear();
}
