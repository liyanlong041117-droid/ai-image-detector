/**
 * detect.js - AI 检测核心模块
 * 调用后端 API 进行 AI 图片检测
 * 支持模型冷启动自动轮询重试
 */

const Detect = {
    detectBtn: null,
    detectNewBtn: null,
    _pollingTimer: null,      // 轮询定时器
    _pollingCount: 0,        // 已轮询次数
    _maxPolling: 12,         // 最多轮询 12 次（每次 5 秒 = 最多 60 秒）
    _pollingFormData: null,  // 轮询时重用的表单数据
    _pollingIsBatch: false,  // 是否批量检测

    init() {
        this.detectBtn = document.getElementById('detectBtn');
        this.detectNewBtn = document.getElementById('detectNewBtn');

        if (this.detectBtn) {
            this.detectBtn.addEventListener('click', () => this.runDetection());
        }

        if (this.detectNewBtn) {
            this.detectNewBtn.addEventListener('click', () => {
                // 停止可能的轮询
                this.stopPolling();
                APP_STATE.selectedFiles = [];
                APP_STATE.detectionResults = [];
                Upload.updateBatchHint();
                Upload.renderPreviews();
                showUploadSection();
                document.getElementById('uploadSection').scrollIntoView({ behavior: 'smooth' });
            });
        }
    },

    // 停止轮询
    stopPolling() {
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
            this._pollingTimer = null;
        }
        this._pollingCount = 0;
        this._pollingFormData = null;
    },

    // 带超时的 fetch
    async fetchWithTimeout(url, options, timeout = 60000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请稍后重试');
            }
            throw error;
        }
    },

    // 执行检测（入口）
    async runDetection() {
        // 停止上一次的轮询
        this.stopPolling();

        if (APP_STATE.selectedFiles.length === 0) {
            showToast('请先选择图片', 'warning');
            return;
        }

        const totalFiles = APP_STATE.selectedFiles.length;
        const isBatch = totalFiles > 1;
        this._pollingIsBatch = isBatch;

        showLoading(isBatch
            ? `正在检测 ${totalFiles} 张图片...`
            : '正在检测中...'
        );

        APP_STATE.detectionResults = [];

        // 构建表单数据（保存一份用于轮询重试）
        const formData = new FormData();
        if (isBatch) {
            APP_STATE.selectedFiles.forEach(file => {
                formData.append('files', file);
            });
        } else {
            formData.append('file', APP_STATE.selectedFiles[0]);
        }
        this._pollingFormData = formData;

        try {
            const url = isBatch
                ? `${CONFIG.API_BASE_URL}/api/detect/batch`
                : `${CONFIG.API_BASE_URL}/api/detect`;

            const response = await this.fetchWithTimeout(url, {
                method: 'POST',
                body: formData
            });

            // 状态码 202 = 模型正在加载，需要轮询
            if (response.status === 202) {
                const data = await response.json();
                this.startPolling(data.estimatedTime || 20);
                return;
            }

            if (!response.ok) {
                throw new Error(`服务器错误: ${response.status}`);
            }

            const data = await response.json();
            this.handleDetectionResult(data, isBatch);

        } catch (err) {
            hideLoading();
            console.error('检测失败:', err);
            showToast('检测失败：' + err.message, 'error');
        }
    },

    // 开始轮询（模型冷启动）
    startPolling(estimatedTime) {
        this._pollingCount = 0;
        const waitSec = Math.max(5, Math.ceil(estimatedTime / 2)); // 每次等 5 秒以上

        showLoading(`⏳ 模型正在启动中，预计需要 ${estimatedTime} 秒...<br><small>已自动等待，请勿关闭页面</small>`);

        const poll = () => {
            this._pollingCount++;
            if (this._pollingCount > this._maxPolling) {
                hideLoading();
                this.stopPolling();
                showToast('模型启动超时，请稍后手动重试', 'error');
                return;
            }

            // 更新加载提示
            const remaining = this._maxPolling - this._pollingCount;
            showLoading(`⏳ 模型启动中，正在第 ${this._pollingCount} 次重试...<br><small>最多再试 ${remaining} 次，请稍候</small>`);

            const url = this._pollingIsBatch
                ? `${CONFIG.API_BASE_URL}/api/detect/batch`
                : `${CONFIG.API_BASE_URL}/api/detect`;

            this.fetchWithTimeout(url, {
                method: 'POST',
                body: this._pollingFormData
            })
            .then(async (response) => {
                if (response.status === 202) {
                    // 还在加载，继续轮询
                    this._pollingTimer = setTimeout(poll, waitSec * 1000);
                    return;
                }

                if (!response.ok) {
                    throw new Error(`服务器错误: ${response.status}`);
                }

                const data = await response.json();
                this.stopPolling();
                this.handleDetectionResult(data, this._pollingIsBatch);
            })
            .catch((err) => {
                hideLoading();
                this.stopPolling();
                console.error('轮询失败:', err);
                showToast('检测失败：' + err.message, 'error');
            });
        };

        // 首次等待后开始轮询
        this._pollingTimer = setTimeout(poll, waitSec * 1000);
    },

    // 处理检测结果（单张或批量）
    handleDetectionResult(data, isBatch) {
        // 单张检测时，如果后端返回失败，直接提示错误
        if (!isBatch && !data.success) {
            hideLoading();
            showToast(data.error || '检测失败，请稍后重试', 'error');
            return;
        }

        if (isBatch) {
            // 批量模式下过滤掉失败项，并给出提示
            const rawResults = data.results || [];
            const failedCount = rawResults.filter(r => !r.success).length;
            if (failedCount > 0) {
                showToast(`${failedCount} 张图片检测失败`, 'warning');
            }
            APP_STATE.detectionResults = rawResults.map((r, i) => ({
                ...r,
                fileName: APP_STATE.selectedFiles[i]?.name || '未知文件',
                fileSize: APP_STATE.selectedFiles[i]?.size || 0,
                timestamp: new Date().toISOString(),
            }));
        } else {
            APP_STATE.detectionResults = [{
                ...data,
                fileName: APP_STATE.selectedFiles[0]?.name || '未知文件',
                fileSize: APP_STATE.selectedFiles[0]?.size || 0,
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
