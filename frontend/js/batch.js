/**
 * batch.js - 批量检测 + 导出功能模块
 */

const Batch = {
    downloadReportBtn: null,
    shareResultBtn: null,

    init() {
        this.downloadReportBtn = document.getElementById('downloadReportBtn');
        this.shareResultBtn = document.getElementById('shareResultBtn');

        if (this.downloadReportBtn) {
            this.downloadReportBtn.addEventListener('click', () => this.downloadReport());
        }

        if (this.shareResultBtn) {
            this.shareResultBtn.addEventListener('click', () => this.shareResult());
        }
    },

    // 下载检测报告
    downloadReport() {
        if (APP_STATE.detectionResults.length === 0) {
            showToast('没有可下载的检测结果', 'warning');
            return;
        }

        let report = '===== AI 图片检测报告 =====\n\n';
        report += `生成时间：${new Date().toLocaleString('zh-CN')}\n`;
        report += `检测数量：${APP_STATE.detectionResults.length} 张\n\n`;
        report += '========================\n\n';

        APP_STATE.detectionResults.forEach((result, i) => {
            report += `【图片 ${i + 1}】${result.fileName}\n`;
            report += `  检测结论：${result.isAIGenerated ? '疑似 AI 生成' : '疑似真实图片'}\n`;
            report += `  AI 生成概率：${Math.round((result.aiProbability || 0) * 100)}%\n`;
            report += `  真实概率：${Math.round((result.realProbability || 0) * 100)}%\n`;
            report += `  置信度：${Math.round((result.confidence || 0) * 100)}%\n`;
            report += `  检测时间：${result.timestamp}\n`;
            if (result.details?.model) {
                report += `  使用模型：${result.details.model}\n`;
            }
            report += '\n';
        });

        report += '----\n';
        report += '免责声明：本报告由 AI 图片检测器生成，结果仅供参考。\n';

        // 创建下载
        const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AI检测报告_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('报告已下载！', 'success');
    },

    // 分享结果
    shareResult() {
        if (APP_STATE.detectionResults.length === 0) {
            showToast('没有可分享的检测结果', 'warning');
            return;
        }

        const result = APP_STATE.detectionResults[0];
        const shareText = `📊 AI 图片检测结果\n\n`
            + `文件：${result.fileName}\n`
            + `结论：${result.isAIGenerated ? '⚠ 疑似 AI 生成' : '✓ 疑似真实图片'}\n`
            + `置信度：${Math.round((result.confidence || 0) * 100)}%\n`
            + `AI 概率：${Math.round((result.aiProbability || 0) * 100)}%\n`
            + `真实概率：${Math.round((result.realProbability || 0) * 100)}%\n\n`
            + `由 AI 图片检测器生成`;

        // 尝试使用 Web Share API
        if (navigator.share) {
            navigator.share({
                title: 'AI 图片检测结果',
                text: shareText,
            }).catch(() => {
                this.copyToClipboard(shareText);
            });
        } else {
            this.copyToClipboard(shareText);
        }
    },

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('检测结果已复制到剪贴板！', 'success');
        }).catch(() => {
            showToast('复制失败，请手动复制', 'error');
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Batch.init();
    window.Batch = Batch;
});
