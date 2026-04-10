/**
 * 条款内容分段工具
 * 
 * 将长文本按"【标题】"格式的段落标记切分成多条独立条款。
 * 每条条款保留段落标题，便于向量检索精准命中。
 * 
 * 切分规则：
 * 1. 按【xxx】段落标题切分
 * 2. 连续的短段落（<50字）合并到前一段
 * 3. 如果原文没有【】标记或只有1段，则保持原文不切分
 * 4. 每段保留标题前缀，独立可理解
 */

/**
 * 将完整产品条款文本按语义段落切分
 * @param content 完整条款文本
 * @param productName 产品名称（用于每段添加上下文标注）
 * @returns 切分后的条款段落数组
 */
export function splitClausesBySection(content: string, productName?: string): string[] {
    if (!content || !content.trim()) return [];

    const text = content.trim();

    // 匹配【xxx】标题格式（中文方括号）
    // 也匹配一些常见变体：一、二、三、## 标题
    const sectionPattern = /(?=【[^】]{1,20}】)|(?=(?:^|\n)(?:一|二|三|四|五|六|七|八|九|十)[、.．])|(?=(?:^|\n)#{1,3}\s)/gm;

    const parts = text.split(sectionPattern).filter(s => s.trim().length > 0);

    // 如果没有切分出多段（<=1段），返回完整原文作为单条
    if (parts.length <= 1) {
        return [text];
    }

    // 合并过短的段落到前一段
    const MIN_SECTION_LENGTH = 50;
    const merged: string[] = [];

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (merged.length > 0 && trimmed.length < MIN_SECTION_LENGTH) {
            // 过短段落合并到上一段
            merged[merged.length - 1] += '\n' + trimmed;
        } else {
            merged.push(trimmed);
        }
    }

    // 如果合并后只剩1段，直接返回完整原文
    if (merged.length <= 1) {
        return [text];
    }

    return merged;
}

/**
 * 判断内容是否适合切分（用于向外部暴露决策信息）
 */
export function shouldSplitContent(content: string): boolean {
    if (!content) return false;
    const sections = splitClausesBySection(content);
    return sections.length > 1;
}
