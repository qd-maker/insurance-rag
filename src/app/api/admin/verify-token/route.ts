import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ valid: false, error: '缺少认证信息' }, { status: 401 });
        }

        const token = authHeader.slice(7).trim();
        const adminToken = process.env.ADMIN_TOKEN;

        if (!adminToken) {
            console.error('[verify-token] ADMIN_TOKEN 未配置');
            return NextResponse.json({ valid: false, error: '服务端配置错误' }, { status: 500 });
        }

        if (token !== adminToken) {
            return NextResponse.json({ valid: false, error: 'Token 无效' }, { status: 401 });
        }

        return NextResponse.json({ valid: true });
    } catch (e: any) {
        return NextResponse.json({ valid: false, error: e?.message || '验证失败' }, { status: 500 });
    }
}
