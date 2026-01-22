import { z } from 'zod';
import { PaginationQuerySchema, PaginationResponseSchema } from './common';

// ============ 审计日志查询参数 Schema ============

export const AuditLogQuerySchema = PaginationQuerySchema.extend({
  productId: z.coerce.number().int().positive().optional(),
});

// ============ 审计日志条目 Schema ============

export const AuditLogEntrySchema = z.object({
  id: z.number(),
  product_id: z.number().nullable(),
  action: z.string(),
  operator: z.string(),
  operator_ip: z.string().nullable(),
  before_snapshot: z.any(),
  after_snapshot: z.any(),
  created_at: z.string(),
  notes: z.string().nullable(),
  product_name: z.string().optional(),
});

// ============ 审计日志响应 Schema ============

export const AuditLogSuccessResponseSchema = z.object({
  success: z.literal(true),
  logs: z.array(AuditLogEntrySchema),
  pagination: PaginationResponseSchema,
});

export const AuditLogErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ============ 类型导出 ============

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export type AuditLogSuccessResponse = z.infer<typeof AuditLogSuccessResponseSchema>;
export type AuditLogErrorResponse = z.infer<typeof AuditLogErrorResponseSchema>;
