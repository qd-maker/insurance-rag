import { z } from 'zod';

// ============ 条款内容 Schema ============

export const ClauseInputSchema = z.object({
  title: z.string().min(1, '条款标题不能为空').max(200, '条款标题不能超过200字').optional(),
  content: z.string().min(10, '条款内容至少需要10个字符').max(50000, '条款内容不能超过50000字'),
});

// ============ 产品添加请求 Schema ============

export const ProductAddRequestSchema = z.object({
  name: z.string().min(1, '产品名称不能为空').max(200, '产品名称不能超过200字'),
  content: z.string().min(1, '产品内容不能为空'),
  clauses: z.array(ClauseInputSchema).min(1, '至少需要一个条款').optional(),
});

// ============ 产品状态切换请求 Schema ============

export const ProductToggleRequestSchema = z.object({
  productId: z.number().int('产品ID必须是整数').positive('产品ID必须是正整数'),
  active: z.boolean(),
  notes: z.string().max(500, '备注不能超过500字').optional(),
});

// ============ 产品检查查询参数 Schema ============

export const ProductCheckQuerySchema = z.object({
  q: z.string().optional().default(''),
});

// ============ 产品列表项 Schema ============

export const ProductListItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean().default(true),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  created_by: z.string().nullable(),
  aliases: z.array(z.string()).default([]),
  version: z.string().default('1.0'),
  last_updated: z.string().default(''),
  source: z.string().default('database'),
});

// ============ 产品添加响应 Schema ============

const StepSchema = z.object({
  step: z.string(),
  status: z.enum(['pending', 'running', 'done', 'error']),
  detail: z.string().optional(),
});

export const ProductAddSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  steps: z.array(StepSchema),
  results: z.object({
    productId: z.number(),
    clauseId: z.number(),
  }),
});

export const ProductAddErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  steps: z.array(StepSchema).optional(),
  results: z.object({
    error: z.string(),
  }).optional(),
});

// ============ 产品状态切换响应 Schema ============

export const ProductToggleSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  product: z.object({
    id: z.number(),
    name: z.string(),
    is_active: z.boolean(),
  }),
});

// ============ 产品检查响应 Schema ============

export const ProductCheckResponseSchema = z.object({
  ok: z.literal(true),
  imported: z.boolean(),
  productExists: z.boolean(),
  clauseExists: z.boolean(),
  matchedProductId: z.number().optional(),
  matchedProductName: z.string().optional(),
  suggestions: z.array(z.string()),
});

// ============ 产品列表响应 Schema ============

export const ProductListResponseSchema = z.array(ProductListItemSchema);

// ============ 产品列表错误响应 Schema ============

export const ProductListErrorResponseSchema = z.object({
  error: z.string(),
});

// ============ 类型导出 ============

export type ClauseInput = z.infer<typeof ClauseInputSchema>;
export type ProductAddRequest = z.infer<typeof ProductAddRequestSchema>;
export type ProductToggleRequest = z.infer<typeof ProductToggleRequestSchema>;
export type ProductCheckQuery = z.infer<typeof ProductCheckQuerySchema>;
export type ProductListItem = z.infer<typeof ProductListItemSchema>;
export type ProductAddSuccessResponse = z.infer<typeof ProductAddSuccessResponseSchema>;
export type ProductAddErrorResponse = z.infer<typeof ProductAddErrorResponseSchema>;
export type ProductToggleSuccessResponse = z.infer<typeof ProductToggleSuccessResponseSchema>;
export type ProductCheckResponse = z.infer<typeof ProductCheckResponseSchema>;
