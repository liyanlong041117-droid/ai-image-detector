/**
 * detect.js - AI 检测核心模块
 * 调用后端 API 进行 AI 图片检测
 */

const Detect = {
    detectBtn: null,
    detectNewBtn: null,

    init() {
        this.detectBtn = document.getElementById('detectBtn');
        this.detectNewBtn = document.getElementById('detectNewBtn');

        if (this.detectBtn) {
            this.detectBtn.addEventListener('click', () => this.runDetection());
        }

        if (this.detectNewBtn) {
            this.detectNewBtn.addEventListener('click', () => {
                APP_STATE.selectedFiles = [];
                APP_STATE.detectionResults = [];
                Upload.updateBatchHint();
                Upload.renderPreviews();
                showUploadSection();
                document.getElementById('uploadSection').scrollIntoView({ behavior: 'smooth' });
            });
        }
    },

    // 执行检测
    async runDetection() {
        if (APP_STATE.selectedFiles.length === 0) {
            showToast('请先选择图片', 'warning');
            return;
        }

        const totalFiles = APP_STATE.selectedFiles.length;
        const isBatch = totalFiles > 1;

        showLoading(isBatch
            ? `正在检测 ${totalFiles} 张图片...`
            : '正在检测中...'
        );

        APP_STATE.detectionResults = [];

        try {
            if (isBatch) {
                // 批量检测
                const formData = new FormData();
                APP_STATE.selectedFiles.forEach(file => {
                    formData.append('files', file);
                });

                const response = await fetch(`${CONFIG.API_BASE_URL}/api/detect/batch`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`服务器错误: ${response.status}`);
                }

                const data = await response.json();
                APP_STATE.detectionResults = data.results.map((r, i) => ({
                    ...r,
                    fileName: APP_STATE.selectedFiles[i].name,
                    fileSize: APP_STATE.selectedFiles[i].size,
                    timestamp: new Date().toISOString(),
                }));
            } else {
                // 单张检测
                const file = APP_STATE.selectedFiles[0];
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch(`${CONFIG.API_BASE_URL}/api/detect`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`服务器错误: ${response.status}`);
                }

                const data = await response.json();
                APP_STATE.detectionResults = [{
                    ...data,
                    fileName: file.name,
                    fileSize: file.size,
                    timestamp: new Date().toISOString(),
                }];
            }

            hideLoading();
            this.renderResults();
            showResultSection();

            // 保存到历史记录
            APP_STATE.detectionResults.forEach(result => {
                History.addRecord(result);
            });

            showToast(
                isBatch
                    ? `已完成 ${APP_STATE.detectionResults.length} 张图片的检测`
                    : '检测完成！',
                'success'
            );

        } catch (err) {
            hideLoading();
            console.error('检测失败:', err);

            // 降级：使用模拟检测
            showToast('后端连接失败，使用模拟检测...', 'warning');
            this.runSimulation();
        }
    },

    // 模拟检测（后端不可用时的降级方案）
    runSimulation() {
        showLoading('模拟检测中...');

        setTimeout(() => {
            APP_STATE.detectionResults = APP_STATE.selectedFiles.map(file => {
                const aiProb = Math.random() * 0.6 + 0.2; // 20%-80%
                const realProb = 1 - aiProb;
                const isAI = aiProb > 0.5;

                return {
                    success: true,
                    isAIGenerated: isAI,
                    confidence: Math.max(aiProb, realProb),
                    aiProbability: aiProb,
                    realProbability: realProb,
                    fileName: file.name,
                    fileSize: file.size,
                    timestamp: new Date().toISOString(),
                    details: {
                        model: 'simulation',
                        warning: '此为模拟结果，请配置后端服务以获取真实检测'
                    }
                };
            });

            hideLoading();
            this.renderResults();
            showResultSection();

            // 保存模拟结果到历史
            APP_STATE.detectionResults.forEach(result => {
                History.addRecord(result);
            });

            showToast('模拟检测完成（请启动后端服务获取真实结果）', 'warning');
        }, 1500);
    },

    // 渲染检测结果
    renderResults() {
        const container = document.getElementById('resultsContainer');

        container.innerHTML = APP_STATE.detectionResults.map((result, index) => {
            const isAI = result.isAIGenerated;
            const aiPercent = Math.round((result.aiProbability || 0) * 100);
            const realPercent = Math.round((result.realProbability || 0) * 100);
            const confidencePercent = Math.round((result.confidence || 0) * 100);

            // 获取对应文件的预览 URL
            const file = APP_STATE.selectedFiles[index];
            const previewUrl = file ? URL.createObjectURL(file) : '';

            return `
                <div class="result-card" id="result-${index}">
                    <div class="result-card-header">
                        ${previewUrl ? `<img src="${previewUrl}" alt="${result.fileName}" class="preview-thumb">` : ''}
                        <div class="result-icon ${isAI ? 'ai' : 'real'}">
                            <i class="fas ${isAI ? 'fa-robot' : 'fa-check-circle'}"></i>
                        </div>
                        <div class="result-title-area">
                            <h3>${result.fileName || '未知文件'}</h3>
                            <span class="badge-tag ${isAI ? 'ai' : 'real'}">
                                ${isAI ? '疑似 AI 生成' : '疑似真实图片'}
                            </span>
                        </div>
                    </div>

                    <div class="result-chart">
                        <div class="chart-item">
                            <div class="chart-label">
                                <span>AI 生成概率</span>
                                <span class="percentage">${aiPercent}%</span>
                            </div>
                            <div class="chart-bar">
                                <div class="chart-fill ai-prob" style="width: 0%"
                                     data-width="${aiPercent}%"></div>
                            </div>
                        </div>
                        <div class="chart-item">
                            <div class="chart-label">
                                <span>真实图片概率</span>
                                <span class="percentage">${realPercent}%</span>
                            </div>
                            <div class="chart-bar">
                                <div class="chart-fill real-prob" style="width: 0%"
                                     data-width="${realPercent}%"></div>
                            </div>
                        </div>
                    </div>

                    <div class="result-details">
                        <h4><i class="fas fa-info-circle"></i> 详细信息</h4>
                        <ul>
                            <li><i class="fas fa-file"></i> 文件大小：${formatFileSize(result.fileSize)}</li>
                            <li><i class="fas fa-chart-simple"></i> 综合置信度：${confidencePercent}%</li>
                            <li><i class="fas fa-microchip"></i> 检测模型：${result.details?.model || '未知'}</li>
                            ${result.details?.warning ? `
                                <li><i class="fas fa-exclamation-triangle"></i> ⚠ ${result.details.warning}</li>` : ''}
                            <li><i class="fas fa-clock"></i> 检测时间：${formatDate(result.timestamp)}</li>
                        </ul>
                    </div>
                </div>
            `;
        }).join('');

        // 触发动效：延迟设置宽度
        setTimeout(() => {
            container.querySelectorAll('.chart-fill[data-width]').forEach(el => {
                el.style.width = el.dataset.width;
            });
        }, 100);
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    Detect.init();
});

window.Detect = Detect;
