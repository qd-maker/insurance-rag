import { z } from 'zod';

// ============ 健康检查子项 Schema ============

const HealthCheckItemSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

// ============ 健康检查响应 Schema ============

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string(),
  checks: z.object({
    environment: HealthCheckItemSchema,
    supabase: HealthCheckItemSchema,
    openai: HealthCheckItemSchema,
    database: HealthCheckItemSchema,
    rag_pipeline: HealthCheckItemSchema,
  }),
});

// ============ 类型导出 ============

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
export type HealthCheckItem = z.infer<typeof HealthCheckItemSchema>;
