"""
PDF → Markdown 解析脚本 (Docling)
用法: python scripts/parse_pdf.py <pdf_path>
输出: JSON 到 stdout { "markdown": "...", "page_count": N }
错误: JSON 到 stdout { "error": "..." }
"""

import sys
import json
from pathlib import Path


def clean_cjk_spaces(text: str) -> str:
    """清除 CJK 字符之间的多余空格（PDF 提取常见问题）"""
    import re

    # CJK 字符范围
    cjk = (
        r'\u4e00-\u9fff'   # CJK Unified Ideographs
        r'\u3400-\u4dbf'   # CJK Extension A
        r'\uf900-\ufaff'   # CJK Compatibility Ideographs
        r'\u3000-\u303f'   # CJK Symbols and Punctuation
        r'\uff00-\uffef'   # Fullwidth Forms
        r'\u2000-\u206f'   # General Punctuation
    )
    cjk_punct = r'\u3001-\u3002\uff0c\uff0e\uff1a\uff1b\uff01\uff1f\u201c\u201d\u2018\u2019\uff08\uff09\u3010\u3011\u300a\u300b'

    # 1. CJK 和 CJK 之间的空格
    text = re.sub(f'([{cjk}])\\s+([{cjk}])', r'\1\2', text)

    # 2. CJK 和中文标点之间的空格
    text = re.sub(f'([{cjk}])\\s+([{cjk_punct}])', r'\1\2', text)
    text = re.sub(f'([{cjk_punct}])\\s+([{cjk}])', r'\1\2', text)

    # 3. 多个连续空格合并为一个（保留换行）
    text = re.sub(r'[^\S\n]+', ' ', text)

    return text


def parse_pdf(pdf_path: str) -> dict:
    """使用 Docling 将 PDF 转换为 Markdown"""
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"文件不存在: {pdf_path}"}

    if path.suffix.lower() != ".pdf":
        return {"error": f"不支持的文件类型: {path.suffix}"}

    # 配置 PDF 解析管线
    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = True  # 支持扫描件
    pdf_options.do_table_structure = True  # 支持表格识别

    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
        },
    )

    result = converter.convert(pdf_path)
    doc = result.document

    markdown = doc.export_to_markdown()
    markdown = clean_cjk_spaces(markdown)  # 清除中文间多余空格
    page_count = result.pages_count if hasattr(result, "pages_count") else 0

    return {"markdown": markdown, "page_count": page_count}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python parse_pdf.py <pdf_path>"}, ensure_ascii=False))
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        result = parse_pdf(pdf_path)
    except Exception as e:
        result = {"error": f"解析失败: {str(e)}"}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
