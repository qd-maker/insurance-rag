import { z } from 'zod';

// ============ 通用错误响应 ============

export const ValidationErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.literal('VALIDATION_ERROR'),
    message: z.string(),
    issues: z.array(z.object({
      path: z.array(z.union([z.string(), z.number()])),
      message: z.string(),
    })),
  }),
});

export const ServerErrorSchema = z.object({
  error: z.string(),
});

export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
});

// ============ 分页参数 ============

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PaginationResponseSchema = z.object({
  offset: z.number(),
  limit: z.number(),
  total: z.number().nullable(),
});

// ============ 类型导出 ============

export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type ServerError = z.infer<typeof ServerErrorSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;
