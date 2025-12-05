import { createClient } from '@supabase/supabase-js';

// 从环境变量中获取 Supabase 配置
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

// 创建 Supabase 客户端
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 导出类型定义
export type Database = {
  public: {
    Tables: {
      products: {
        Row: {
          id: number;
          name: string;
          description: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          description?: string | null;
        };
        Update: {
          id?: number;
          name?: string;
          description?: string | null;
        };
      };
      clauses: {
        Row: {
          id: number;
          product_id: number | null;
          content: string | null;
          embedding: number[] | null;
        };
        Insert: {
          id?: number;
          product_id?: number | null;
          content?: string | null;
          embedding?: number[] | null;
        };
        Update: {
          id?: number;
          product_id?: number | null;
          content?: string | null;
          embedding?: number[] | null;
        };
      };
    };
    Functions: {
      match_clauses: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
        };
        Returns: Array<{
          id: number;
          product_id: number | null;
          content: string | null;
          similarity: number;
        }>;
      };
    };
  };
};

