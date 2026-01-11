# FastAPI 后端开发规则（fastapi_backend_rules.md）

> **定位**
> 统一 FastAPI 后端的工程规范，目标是：**MVP 快速可交付 + 正确率高 + 可调试 + 面试表述稳定**。
>
> **优先级声明**
> 当 IDE / AI 的建议与本文档冲突时，**以本文档为准**。

---

## 1. 核心原则（必须遵守）

1) **可读性优先**
- 代码要能被“未来的你”快速看懂
- 反对过度抽象、过度泛型

2) **失败路径显式**
- 所有可能失败的外部调用（DB / LLM / 向量库 / HTTP）必须有明确异常处理
- 不能 silent fail

3) **一致性优先**
- 错误格式、日志格式、分页格式、鉴权策略全项目一致

4) **MVP 先稳后快**
- 优先保证主路径稳定，再做性能优化（缓存/并发/批处理）

---

## 2. 推荐项目结构（MVP 友好）

建议（可按项目规模裁剪）：

app/
main.py
api/
v1/
routes_xxx.py
core/
config.py
logging.py
security.py
schemas/
xxx.py
services/
xxx_service.py
repos/
xxx_repo.py
db/
session.py
models.py
utils/
time.py
ids.py
tests/


**边界规则：**
- `routes`：只做参数校验、鉴权依赖、调用 service、返回响应
- `services`：业务逻辑（可组合 repo / 外部 API）
- `repos`：数据库访问
- `schemas`：Pydantic 输入/输出模型（请求/响应的“契约”）

---

## 3. 统一配置管理（单一入口）

### 3.1 配置单一加载点
- 全项目只允许从 `app/core/config.py` 读取配置
- 禁止在业务代码里到处读 `os.environ`

示例（Pydantic Settings 风格）：
```py
# app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_ENV: str = "dev"
    API_PREFIX: str = "/api/v1"
    DATABASE_URL: str
    OPENAI_API_KEY: str | None = None

settings = Settings()
3.2 启动时配置校验
必填项缺失直接启动失败（Fail Fast）

高风险：production 环境必须更严格（例如禁用 debug）

4. API 设计规范（强约束）
4.1 路由与版本
必须有版本前缀：/api/v1/...

资源命名用名词复数：/users /documents

4.2 统一响应模型
所有接口（包括错误）必须返回结构化 JSON

返回必须可预测，便于前端与测试

推荐响应外壳（可选但强烈建议统一）：

{
  "success": true,
  "data": {...},
  "request_id": "..."
}
错误外壳：

{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "xxx",
    "details": {...}
  },
  "request_id": "..."
}
4.3 HTTP 状态码约定（必须遵守）
200：成功读取/查询

201：创建成功

204：删除成功且不返回 body（慎用，MVP 可统一 200）

400：业务参数错误（不是 Pydantic 校验错误）

401：未认证

403：已认证但无权限

404：资源不存在

409：冲突（重复创建/状态冲突）

422：Pydantic 校验错误（FastAPI 默认）

429：限流

500：未捕获异常（必须减少出现）

5. Pydantic 模型与校验（正确率核心）
所有入参必须有 Pydantic schema

对外响应必须声明 response_model

禁止返回“随便拼的 dict”

5.1 字段设计
明确类型、默认值、约束（min_length、pattern、gt/lt）

使用枚举（Enum）表达状态，禁止魔法字符串散落

5.2 业务校验位置
结构校验：Pydantic（schemas）

业务校验：service 层（例如权限、状态、是否存在）

6. 错误处理（必须全局统一）
6.1 全局异常处理器
必须实现：

业务异常（自定义）

外部依赖异常（DB/HTTP/LLM）

未知异常兜底（返回 request_id，记录 stack trace）

推荐自定义异常：

class AppError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details: dict | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
6.2 错误信息原则
对用户：短、清楚、可行动（下一步怎么做）

对日志：完整（堆栈、上下文、request_id）

7. 日志与可观测性（MVP 也要有）
7.1 Request ID
每个请求必须生成/透传 request_id

记录到日志与响应中（便于排查）

7.2 日志规范
使用结构化日志（至少包含：level、time、request_id、path、cost_ms）

禁止在生产打印敏感信息（key/token/用户隐私）

8. 数据库与事务（稳定性核心）
8.1 分层规则
routes 不直接操作 DB

DB 操作集中在 repos

8.2 事务规则
需要原子性时必须使用事务

失败时必须回滚，不能“半成功”

8.3 幂等性（强烈建议）
对创建类接口（尤其会被前端重试的）：

支持 idempotency key（MVP 可先不做，但要在文档中标注是否支持）

9. 外部调用（LLM / 向量库 / HTTP）规范
必须设置超时（timeout）

必须处理重试策略（仅对可重试错误，如网络超时；避免重复扣费）

必须记录关键参数与耗时（但不记录敏感内容）

必须有降级/兜底策略（返回明确提示 or 拒答）

10. 性能与并发（先稳后快）
10.1 默认策略
先保证正确率 + 可观测

再做缓存（例如：embedding 缓存、热点 query 缓存）

10.2 背景任务
耗时任务（向量生成、批处理）尽量放到后台任务/队列（MVP 可以先 BackgroundTasks）

必须可重试、可恢复、可观测

11. 安全底线（必须）
秘钥只来自环境变量/密钥管理，绝不 hardcode

CORS 最小化开放（不要 * 上生产）

认证鉴权必须显式（即使 MVP 简化，也要“可升级”）

12. 测试与回归（MVP 也要最低线）
最低要求：

每个核心接口至少 1 条 happy path

至少覆盖 1 条失败路径（比如 400/404/422）

建议：

service 层用单测

routes 用集成测试（TestClient）

13. 变更规则（避免越改越乱）
每次修改必须说明：

修复/新增了什么

影响的接口与返回结构

是否引入新依赖、新风险

如何验证（测试用例/脚本）

复利更新规则（必须执行）
在以下情况更新本文档或补充“错误模式”：

某个后端问题调试 ≥ 30 分钟

出现重复 bug / 重复设计争论

线上/演示出现不可控错误

只追加，不重写；写规则，不写日记。