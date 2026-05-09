/**
 * Query Router - 智能查询路由
 * 
 * 根据 query 的意图和复杂度，决定走哪条检索路径：
 * - simple product lookup → direct retrieval (skip HyDE)
 * - specific question → HyDE + Hybrid + Rerank
 * - comparison → Multi-product retrieval + Merge
 * - complex → Sub-question decomposition
 */

import { ParsedQuery, QueryIntent, PipelineConfig } from './types';

export type QueryType = QueryIntent;

export interface RoutingDecision {
  intent: QueryIntent;
  strategy: 'direct' | 'hyde_hybrid' | 'multi_retrieve' | 'decompose';
  config: Partial<PipelineConfig>;
  subQueries?: string[];
  reasoning: string;
}

export class QueryRouter {
  private productNames: string[];

  constructor(productNames: string[] = []) {
    this.productNames = productNames;
  }

  /**
   * 更新已知产品名列表（用于精确匹配判断）
   */
  updateProductNames(names: string[]) {
    this.productNames = names;
  }

  /**
   * 解析并路由查询
   */
  async route(query: string): Promise<{ parsed: ParsedQuery; decision: RoutingDecision }> {
    const parsed = this.parseQuery(query);
    const decision = this.decide(parsed);
    return { parsed, decision };
  }

  /**
   * 解析查询 - 提取意图、实体、复杂度
   */
  private parseQuery(query: string): ParsedQuery {
    const normalized = this.normalize(query);
    const entities = this.extractEntities(query);
    const intent = this.classifyIntent(query, entities);
    const complexity = this.assessComplexity(query, intent);

    return {
      original: query,
      normalized,
      intent,
      entities,
      complexity,
    };
  }

  /**
   * 规范化查询
   */
  private normalize(query: string): string {
    return query
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[\s\u3000]+/g, ' ')
      .trim();
  }

  /**
   * 实体提取 - 识别产品名和关键词
   */
  private extractEntities(query: string): { productNames: string[]; keywords: string[] } {
    const matchedProducts: string[] = [];
    const queryNorm = this.normalize(query);
    // 去掉括号内容用于更宽松的匹配
    const queryCore = queryNorm.replace(/[（(][^)）]*[)）]/g, '').trim();

    for (const name of this.productNames) {
      const nameNorm = this.normalize(name);
      const nameCore = nameNorm.replace(/[（(][^)）]*[)）]/g, '').trim();
      // 多级匹配：完全包含 → 去括号后包含 → 核心名称相似
      if (
        queryNorm.includes(nameNorm) || nameNorm.includes(queryNorm) ||
        queryCore.includes(nameCore) || nameCore.includes(queryCore) ||
        (queryCore.length >= 4 && nameCore.length >= 4 && (
          queryCore.includes(nameCore.slice(0, Math.max(4, nameCore.length - 2))) ||
          nameCore.includes(queryCore.slice(0, Math.max(4, queryCore.length - 2)))
        ))
      ) {
        matchedProducts.push(name);
      }
    }

    // 关键词提取（保险领域）
    const domainKeywords = [
      '保障', '免赔', '理赔', '等待期', '犹豫期', '保费',
      '保额', '缴费', '给付', '责任免除', '除外', '承保',
      '续保', '退保', '受益人', '投保人', '被保险人',
    ];
    const keywords = domainKeywords.filter(kw => query.includes(kw));

    return { productNames: matchedProducts, keywords };
  }

  /**
   * 意图分类
   */
  private classifyIntent(query: string, entities: { productNames: string[]; keywords: string[] }): QueryIntent {
    // 对比意图
    if (query.includes('对比') || query.includes('比较') || query.includes('哪个好') || query.includes('区别')) {
      return 'comparison';
    }

    // 检测问句模式（即使无领域关键词，有问句词也算 specific_question）
    const hasQuestionPattern = /什么|哪些|怎么|如何|多少|能不能|是否|适合|包含|包括|覆盖|赔不赔|有没有/.test(query);

    // 有明确产品名 + 有问句模式 → 具体问题
    if (entities.productNames.length > 0 && hasQuestionPattern) {
      return 'specific_question';
    }

    // 有明确产品名 + 无具体问题关键词且无问句 → 产品摘要
    if (entities.productNames.length > 0 && entities.keywords.length === 0) {
      return 'product_summary';
    }

    // 有产品名 + 有具体关键词 → 具体问题
    if (entities.productNames.length > 0 && entities.keywords.length > 0) {
      return 'specific_question';
    }

    // 通用问答
    if (query.includes('？') || query.includes('?') || query.includes('什么') || query.includes('怎么') || query.includes('如何')) {
      return 'general_qa';
    }

    // 默认当作产品摘要
    return 'product_summary';
  }

  /**
   * 复杂度评估
   */
  private assessComplexity(query: string, intent: QueryIntent): 'simple' | 'moderate' | 'complex' {
    if (intent === 'product_summary') return 'simple';
    if (intent === 'comparison') return 'complex';
    if (query.length > 50 || query.includes('并且') || query.includes('以及')) return 'moderate';
    return 'simple';
  }

  /**
   * 路由决策
   */
  private decide(parsed: ParsedQuery): RoutingDecision {
    switch (parsed.intent) {
      case 'product_summary':
        // 已知产品 → 直接按 product_id 全量取，跳过 HyDE
        if (parsed.entities.productNames.length > 0) {
          return {
            intent: parsed.intent,
            strategy: 'direct',
            config: { enableHyDE: false, enableRerank: false },
            reasoning: `产品名精确匹配 "${parsed.entities.productNames[0]}"，直接按 product_id 取全量条款`,
          };
        }
        // 未知产品名 → HyDE + Hybrid
        return {
          intent: parsed.intent,
          strategy: 'hyde_hybrid',
          config: { enableHyDE: true, enableRerank: true },
          reasoning: '未匹配到已知产品名，启用 HyDE 增强语义检索',
        };

      case 'specific_question':
        return {
          intent: parsed.intent,
          strategy: 'hyde_hybrid',
          config: { enableHyDE: true, enableRerank: true, retrievalTopK: 15 },
          reasoning: '具体问题需要精准检索，启用完整 HyDE + Rerank pipeline',
        };

      case 'comparison':
        return {
          intent: parsed.intent,
          strategy: 'multi_retrieve',
          config: { enableHyDE: false, enableRerank: true, retrievalTopK: 30 },
          subQueries: parsed.entities.productNames.map(name => `${name} 产品信息`),
          reasoning: `多产品对比，分别检索 ${parsed.entities.productNames.length} 个产品后合并`,
        };

      case 'general_qa':
        return {
          intent: parsed.intent,
          strategy: 'hyde_hybrid',
          config: { enableHyDE: true, enableRerank: true, retrievalTopK: 10 },
          reasoning: '通用问答，标准 HyDE + Hybrid 流程',
        };

      default:
        return {
          intent: 'general_qa',
          strategy: 'hyde_hybrid',
          config: {},
          reasoning: 'Fallback to default strategy',
        };
    }
  }
}
