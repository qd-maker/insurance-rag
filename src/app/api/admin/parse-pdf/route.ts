import { NextResponse } from 'next/server';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(req: Request) {
    // ============ 1. 验证 Token ============
    const authHeader = req.headers.get('Authorization');
    const providedToken = authHeader?.replace('Bearer ', '');

    if (!ADMIN_TOKEN || providedToken !== ADMIN_TOKEN) {
        return NextResponse.json({ error: '认证失败' }, { status: 401 });
    }

    // ============ 2. 接收文件 ============
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return NextResponse.json({ error: '请求格式错误，需要 multipart/form-data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    if (!file) {
        return NextResponse.json({ error: '未找到 PDF 文件' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ error: '仅支持 PDF 文件' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `文件过大，最大 ${MAX_FILE_SIZE / 1024 / 1024}MB` }, { status: 400 });
    }

    // ============ 3. 保存临时文件 ============
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!existsSync(tmpDir)) {
        await mkdir(tmpDir, { recursive: true });
    }

    const tmpPath = path.join(tmpDir, `upload_${Date.now()}_${file.name}`);

    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(tmpPath, buffer);

        // ============ 4. 调用 Python Docling 解析 ============
        const scriptPath = path.join(process.cwd(), 'scripts', 'parse_pdf.py');

        const { stdout, stderr } = await execFileAsync('python', [scriptPath, tmpPath], {
            timeout: 300_000, // 5分钟超时（大PDF或首次加载模型较慢）
            maxBuffer: 100 * 1024 * 1024, // 100MB stdout buffer
            encoding: 'utf-8',
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        if (stderr && !stdout) {
            return NextResponse.json({ error: `解析错误: ${stderr.slice(0, 500)}` }, { status: 500 });
        }

        // ============ 5. 解析输出 ============
        let result: { markdown?: string; page_count?: number; error?: string };
        try {
            result = JSON.parse(stdout);
        } catch {
            return NextResponse.json({ error: '解析脚本输出格式异常' }, { status: 500 });
        }

        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            markdown: result.markdown || '',
            pageCount: result.page_count || 0,
            fileName: file.name,
        });

    } catch (error: any) {
        // 区分超时和其他错误
        if (error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            return NextResponse.json({ error: 'PDF 解析超时或文件过大' }, { status: 500 });
        }
        return NextResponse.json({ error: `解析失败: ${error.message}` }, { status: 500 });

    } finally {
        // ============ 6. 清理临时文件 ============
        try { await unlink(tmpPath); } catch { /* ignore */ }
    }
}
