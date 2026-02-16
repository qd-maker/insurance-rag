/**
 * 日志轮转提醒脚本
 * 
 * 检查 logs/ 目录大小，超过阈值时输出警告
 * 
 * 用法：npx tsx scripts/check-log-size.ts [--threshold 100]
 */

import * as fs from 'fs';
import * as path from 'path';

// ========== 配置 ==========
const DEFAULT_THRESHOLD_MB = 100;

// ========== 工具函数 ==========

function parseArgs(): { thresholdMB: number } {
    const args = process.argv.slice(2);
    let thresholdMB = DEFAULT_THRESHOLD_MB;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--threshold' && args[i + 1]) {
            thresholdMB = parseInt(args[i + 1], 10);
        }
    }

    return { thresholdMB };
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function getDirectorySize(dirPath: string): number {
    if (!fs.existsSync(dirPath)) {
        return 0;
    }

    let totalSize = 0;
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            totalSize += getDirectorySize(filePath);
        } else {
            totalSize += stat.size;
        }
    }

    return totalSize;
}

interface FileInfo {
    name: string;
    size: number;
    modified: Date;
}

function getFileInfos(dirPath: string): FileInfo[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const files = fs.readdirSync(dirPath);
    const infos: FileInfo[] = [];

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
            infos.push({
                name: file,
                size: stat.size,
                modified: stat.mtime,
            });
        }
    }

    return infos.sort((a, b) => b.size - a.size);
}

// ========== 主函数 ==========

async function main() {
    console.log('📁 日志轮转检查脚本启动...\n');

    const { thresholdMB } = parseArgs();
    const logsDir = path.join(process.cwd(), 'logs');

    if (!fs.existsSync(logsDir)) {
        console.log('ℹ️ logs/ 目录不存在，无需检查');
        process.exit(0);
    }

    // 计算目录总大小
    const totalSize = getDirectorySize(logsDir);
    const totalSizeMB = totalSize / (1024 * 1024);

    console.log(`📊 日志目录: ${logsDir}`);
    console.log(`📦 总大小: ${formatBytes(totalSize)} (阈值: ${thresholdMB} MB)`);

    // 获取文件列表
    const files = getFileInfos(logsDir);

    if (files.length > 0) {
        console.log(`\n📋 文件列表 (${files.length} 个文件):`);
        console.log('-'.repeat(60));

        for (const file of files.slice(0, 20)) { // 只显示前 20 个
            const sizeStr = formatBytes(file.size).padStart(12);
            const dateStr = file.modified.toISOString().slice(0, 10);
            console.log(`  ${sizeStr}  ${dateStr}  ${file.name}`);
        }

        if (files.length > 20) {
            console.log(`  ... 还有 ${files.length - 20} 个文件`);
        }
    }

    // 检查是否超过阈值
    console.log('\n' + '='.repeat(60));

    if (totalSizeMB >= thresholdMB) {
        console.log(`\n⚠️  警告：日志目录大小 (${formatBytes(totalSize)}) 已超过阈值 (${thresholdMB} MB)！`);
        console.log('\n建议操作：');
        console.log('  1. 归档旧日志文件');
        console.log('  2. 删除过期日志');
        console.log('  3. 调整日志保留策略');
        console.log('\n示例命令：');
        console.log('  # 删除 30 天前的日志');
        console.log('  find logs/ -name "*.jsonl" -mtime +30 -delete');
        console.log('  # 压缩旧日志');
        console.log('  gzip logs/query_202601*.jsonl');

        // 返回非零退出码，便于 CI 集成
        process.exit(1);
    } else {
        const usagePercent = ((totalSizeMB / thresholdMB) * 100).toFixed(1);
        console.log(`\n✅ 日志目录大小正常 (使用率: ${usagePercent}%)`);

        if (totalSizeMB >= thresholdMB * 0.8) {
            console.log(`\n⚠️ 提示：已使用 ${usagePercent}%，建议关注日志增长趋势`);
        }

        process.exit(0);
    }
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});
