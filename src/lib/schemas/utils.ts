import { z, ZodSchema, ZodError } from 'zod';
import { NextResponse } from 'next/server';

// ============ 格式化 Zod 错误 ============

export interface FormattedZodIssue {
  path: (string | number | symbol)[];
  message: string;
}

export function formatZodError(error: ZodError): FormattedZodIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}

// ============ 验证请求体 ============

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ZodError };

export function validateRequest<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// ============ 返回验证错误响应 ============

export function validationErrorResponse(error: ZodError, status: number = 422) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求参数校验失败',
        issues: formatZodError(error),
      },
    },
    { status }
  );
}

// ============ 解析并验证请求体 ============

export async function parseAndValidate<T>(
  req: Request,
  schema: ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求体格式错误，必须是有效的 JSON',
            issues: [],
          },
        },
        { status: 400 }
      ),
    };
  }

  const result = validateRequest(schema, body);
  if (!result.success) {
    return {
      success: false,
      response: validationErrorResponse(result.error),
    };
  }

  return { success: true, data: result.data };
}

// ============ 解析查询参数 ============

export function parseQueryParams<T>(
  url: string,
  schema: ZodSchema<T>
): ValidationResult<T> {
  const { searchParams } = new URL(url);
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return validateRequest(schema, params);
}
