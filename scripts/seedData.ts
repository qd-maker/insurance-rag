export type SeedProduct = {
  name: string;
  // 结构化输入（旧方式，可继续使用）
  description?: string;
  clauses?: string[];
  // 原始内容（新方式）：只需提供一段包含条款/卖点的文本，脚本会自动用 AI 提取 description 与 clauses
  content?: string;
};

// 示例数据：两种方式皆可使用；推荐仅提供 name + content（自动抽取）
export const productsToInsert: SeedProduct[] = [
  // 新方式：只填 name + content（脚本会自动抽取 description 与 clauses）
  {
    name: '安心无忧医疗险',
    content:
      '这是一款面向大众的百万医疗险，支持住院医疗费用报销，设定年度免赔额 1 万元；重疾确诊可一次性给付 10 万；等待期 30 天；对既往症除外。',
  },

  // 旧方式：直接提供结构化 description 与 clauses（仍然兼容）
  // {
  //   name: '安心无忧医疗险（结构化示例）',
  //   description: '百万医疗，重疾保障',
  //   clauses: [
  //     '本合同对既往症除外，等待期为 30 天。',
  //     '住院医疗费用 100% 报销，年度免赔额 1 万元。',
  //     '重疾确诊一次性给付 10 万元。',
  //   ],
  // },
];
