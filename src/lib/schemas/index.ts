// ============ 统一导出所有 Schema ============

// Common
export {
  ValidationErrorSchema,
  ServerErrorSchema,
  SuccessResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  type ValidationError,
  type ServerError,
  type SuccessResponse,
  type PaginationQuery,
  type PaginationResponse,
} from './common';

// Search
export {
  SearchRequestSchema,
  SearchSuccessResponseSchema,
  SearchNotFoundResponseSchema,
  type SearchRequest,
  type SearchSuccessResponse,
  type SearchNotFoundResponse,
  type SourcedField,
  type CoverageItem,
  type ExclusionItem,
  type SourceInfo,
} from './search';

// Products
export {
  ClauseInputSchema,
  ProductAddRequestSchema,
  ProductToggleRequestSchema,
  ProductCheckQuerySchema,
  ProductListItemSchema,
  ProductListResponseSchema,
  ProductListErrorResponseSchema,
  ProductAddSuccessResponseSchema,
  ProductAddErrorResponseSchema,
  ProductToggleSuccessResponseSchema,
  ProductCheckResponseSchema,
  type ClauseInput,
  type ProductAddRequest,
  type ProductToggleRequest,
  type ProductCheckQuery,
  type ProductListItem,
  type ProductAddSuccessResponse,
  type ProductAddErrorResponse,
  type ProductToggleSuccessResponse,
  type ProductCheckResponse,
} from './products';

// Health
export {
  HealthCheckResponseSchema,
  type HealthCheckResponse,
  type HealthCheckItem,
} from './health';

// Audit
export {
  AuditLogQuerySchema,
  AuditLogEntrySchema,
  AuditLogSuccessResponseSchema,
  AuditLogErrorResponseSchema,
  type AuditLogQuery,
  type AuditLogEntry,
  type AuditLogSuccessResponse,
  type AuditLogErrorResponse,
} from './audit';

// Utils
export {
  formatZodError,
  validateRequest,
  validationErrorResponse,
  parseAndValidate,
  parseQueryParams,
  type FormattedZodIssue,
  type ValidationResult,
} from './utils';
