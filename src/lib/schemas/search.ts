import { z } from 'zod';

// ============ 搜索请求 Schema ============

export const SearchRequestSchema = z.object({
  query: z.string().min(1, '查询内容不能为空'),
  matchCount: z.number().int().min(1).max(50).optional().default(10),
  matchThreshold: z.number().min(0).max(1).optional().default(0.1),
  debug: z.boolean().optional().default(false),
});

// ============ 搜索响应 - 字段级引用结构 ============

const SourcedFieldSchema = z.object({
  value: z.string(),
  sourceClauseId: z.number().nullable(),
});

const CoverageItemSchema = z.object({
  title: z.string(),
  value: z.string(),
  desc: z.string(),
  sourceClauseId: z.number().nullable(),
});

const ExclusionItemSchema = z.object({
  value: z.string(),
  sourceClauseId: z.number().nullable(),
});

const SourceInfoSchema = z.object({
  clauseId: z.number(),
  productName: z.string().nullable(),
});

const ClauseMapItemSchema = z.object({
  snippet: z.string(),
  productName: z.string().nullable(),
});

// ============ 搜索成功响应 ============

export const SearchSuccessResponseSchema = z.object({
  productName: SourcedFieldSchema,
  overview: SourcedFieldSchema,
  coreCoverage: z.array(CoverageItemSchema),
  exclusions: z.array(ExclusionItemSchema),
  targetAudience: SourcedFieldSchema,
  salesScript: z.array(z.string()),
  rawTerms: z.string(),
  sources: z.array(SourceInfoSchema),
  clauseMap: z.record(z.coerce.number(), ClauseMapItemSchema),
  _cached: z.boolean().optional(),
  _debugUsedFallback: z.boolean().optional(),
  _debugContext: z.string().optional(),
  _debugMatches: z.array(z.any()).optional(),
});

// ============ 搜索无结果响应 ============

export const SearchNotFoundResponseSchema = z.object({
  ok: z.boolean(),
  retrieval: z.array(z.any()).optional(),
  notFound: z.object({
    query: z.string(),
    reason: z.enum(['NO_SIMILAR_PRODUCT', 'INVALID_INPUT']),
    message: z.string().optional(),
  }),
});

// ============ 类型导出 ============

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchSuccessResponse = z.infer<typeof SearchSuccessResponseSchema>;
export type SearchNotFoundResponse = z.infer<typeof SearchNotFoundResponseSchema>;
export type SourcedField = z.infer<typeof SourcedFieldSchema>;
export type CoverageItem = z.infer<typeof CoverageItemSchema>;
export type ExclusionItem = z.infer<typeof ExclusionItemSchema>;
export type SourceInfo = z.infer<typeof SourceInfoSchema>;
