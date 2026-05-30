# 产品发布流 API Contract

本文档约定业务员新增产品、管理员发布/下架产品的接口行为。新增产品默认保存为草稿，不会立即出现在前台问答产品列表；管理员发布后才对用户可见。

## POST /api/products/add

用途：业务员在后台上传或粘贴保险条款后，提交为产品草稿，并生成条款分段与向量数据。

认证：`Authorization: Bearer <ADMIN_TOKEN>`

请求：

```json
{
  "name": "臻享一生重大疾病保险",
  "content": "完整保险条款文本...",
  "clauses": [
    {
      "title": "保险责任",
      "content": "本合同的保险责任包括..."
    }
  ]
}
```

字段规则：

- `name`：必填，2-100 个字符。
- `content`：必填，至少 50 个字符。
- `clauses`：可选；如果不传，服务端按文本自动分段。

成功响应 `200`：

```json
{
  "success": true,
  "message": "产品 \"臻享一生重大疾病保险\" 已保存为草稿并生成向量，发布后前台可见。",
  "steps": [
    { "step": "校验产品内容", "status": "done", "detail": "已接收完整条款文本" },
    { "step": "AI 抽取产品描述", "status": "done", "detail": "..." },
    { "step": "保存产品草稿", "status": "done", "detail": "产品状态：草稿" },
    { "step": "语义分段 + 生成向量", "status": "done", "detail": "..." },
    { "step": "写入条款和向量", "status": "done", "detail": "..." },
    { "step": "等待审核发布", "status": "done", "detail": "发布后前台可检索" }
  ],
  "results": {
    "productId": 12,
    "clauseId": 301,
    "isActive": false,
    "status": "draft"
  }
}
```

错误响应：

- `400`：请求参数不合法，返回 `details` 说明字段错误。
- `401`：缺少或错误的 `ADMIN_TOKEN`。
- `500`：保存产品、生成向量或写入条款失败。

## POST /api/products/toggle-status

用途：管理员发布草稿产品，或下架已发布产品。

认证：`Authorization: Bearer <ADMIN_TOKEN>`

请求：

```json
{
  "productId": 12,
  "active": true,
  "notes": "条款审核通过"
}
```

字段规则：

- `productId`：必填，产品数字 ID。
- `active`：必填；`true` 表示发布，`false` 表示下架。
- `notes`：可选，记录发布或下架原因。

成功响应 `200`：

```json
{
  "success": true,
  "message": "产品已发布，前台用户现在可以检索和咨询该产品。",
  "product": {
    "id": 12,
    "name": "臻享一生重大疾病保险",
    "is_active": true
  }
}
```

错误响应：

- `400`：请求参数不合法。
- `401`：缺少或错误的 `ADMIN_TOKEN`。
- `404`：产品不存在。
- `500`：状态更新或审计日志写入失败。

## GET /api/products/list

用途：读取产品列表。后台用于管理全部产品；前台问答只展示 `is_active=true` 且已有条款的产品。

成功响应 `200`：

```json
[
  {
    "id": 12,
    "name": "臻享一生重大疾病保险",
    "description": "覆盖重疾、轻症和身故责任...",
    "is_active": true,
    "created_at": "2026-05-29T10:00:00.000Z",
    "updated_at": "2026-05-29T10:00:00.000Z",
    "created_by": "admin",
    "aliases": [],
    "version": "1.0",
    "last_updated": "2026-05-29",
    "source": "database"
  }
]
```
