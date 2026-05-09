/**
 * V2 Document Ingestion API
 * 
 * 接收 PDF 或文本文件，通过 RAG Ingestion Pipeline 处理后存入数据库
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DocumentIngestionPipeline } from '@/lib/rag/ingestion';

export const runtime = 'nodejs';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'text/plain', 'text/markdown']);
const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md'];

export async function POST(req: NextRequest) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json({ error: 'Missing env vars' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: '请求必须使用 multipart/form-data' },
        { status: 400 }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > MAX_FILE_SIZE + 1024 * 1024) {
      return NextResponse.json(
        { error: '请求体过大，请上传 10MB 以内的文件' },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const productNameRaw = formData.get('productName') as string | null;
    const productName = productNameRaw?.trim();

    if (!file || !productName) {
      return NextResponse.json(
        { error: '需要提供 file 和 productName 参数' },
        { status: 400 }
      );
    }

    if (productName.length > 80) {
      return NextResponse.json(
        { error: '产品名称过长，请控制在 80 个字符以内' },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '文件大小需在 1B 到 10MB 之间' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
    if (!ALLOWED_FILE_TYPES.has(file.type) && !hasAllowedExtension) {
      return NextResponse.json(
        { error: '仅支持 PDF、TXT、MD 文件' },
        { status: 400 }
      );
    }

    const pipeline = new DocumentIngestionPipeline();

    const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
    if (isPdf) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await pipeline.ingestPDF(buffer, productName, supabase);
      return NextResponse.json(result);
    } else {
      const text = await file.text();
      if (!text.trim()) {
        return NextResponse.json(
          { error: '文件内容为空' },
          { status: 400 }
        );
      }
      const result = await pipeline.ingest(text, productName, supabase);
      return NextResponse.json(result);
    }
  } catch (error: unknown) {
    console.error('[Ingest] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
