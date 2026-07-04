/**
 * history.js - 历史记录模块
 * 使用 localStorage 存储检测历史
 */

const HISTORY_KEY = 'ai-detector-history';
const MAX_HISTORY = 50;

const History = {
    sidebar: null,
    overlay: null,
    historyList: null,
    historyCountBadge: null,

    init() {
        this.sidebar = document.getElementById('historySidebar');
        this.overlay = document.getElementById('sidebarOverlay');
        this.historyList = document.getElementById('historyList');
        this.historyCountBadge = document.getElementById('historyCount');

        // 打开历史
        document.getElementById('historyBtn')?.addEventListener('click', () => this.open());

        // 关闭历史
        document.getElementById('closeHistoryBtn')?.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());

        // 清空历史
        document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
            if (confirm('确定要清空所有检测历史吗？此操作不可撤销。')) {
                this.clearAll();
            }
        });
    },

    // 获取所有历史记录
    getAll() {
        try {
            const data = localStorage.getItem(HISTORY_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    },

    // 保存记录
    addRecord(result) {
        const records = this.getAll();

        // 每条记录存储必要字段
        const record = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileName: result.fileName,
            fileSize: result.fileSize,
            isAIGenerated: result.isAIGenerated,
            confidence: result.confidence,
            aiProbability: result.aiProbability,
            realProbability: result.realProbability,
            timestamp: result.timestamp,
            details: result.details,
            // 存储缩略图（Base64，最多存最近10条的缩略图）
            thumbnail: null,
        };

        // 如果文件还在 APP_STATE 中，生成缩略图
        if (APP_STATE.selectedFiles.length > 0) {
            const file = APP_STATE.selectedFiles.find(
                f => f.name === result.fileName && f.size === result.fileSize
            );
            if (file) {
                this.generateThumbnail(file).then(dataUrl => {
                    record.thumbnail = dataUrl;
                    this.saveRecord(record, records);
                });
                return;
            }
        }

        this.saveRecord(record, records);
    },

    async generateThumbnail(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxSize = 112;
                    let w = img.width;
                    let h = img.height;
                    const ratio = maxSize / Math.max(w, h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.6));
                };
                img.onerror = () => resolve(null);
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    saveRecord(record, existingRecords) {
        existingRecords.unshift(record);

        // 最多存 50 条
        if (existingRecords.length > MAX_HISTORY) {
            existingRecords = existingRecords.slice(0, MAX_HISTORY);
        }

        // 超过 10 条旧的记录清除缩略图以节省空间
        existingRecords.forEach((r, i) => {
            if (i >= 10) r.thumbnail = null;
        });

        localStorage.setItem(HISTORY_KEY, JSON.stringify(existingRecords));
        this.updateBadge();
    },

    // 删除单条记录
    removeRecord(id) {
        let records = this.getAll();
        records = records.filter(r => r.id !== id);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
        this.updateBadge();
        this.render();
    },

    // 清空所有
    clearAll() {
        localStorage.removeItem(HISTORY_KEY);
        this.updateBadge();
        this.render();
        showToast('历史记录已清空', 'info');
    },

    // 打开侧边栏
    open() {
        this.render();
        this.sidebar.classList.add('open');
        this.overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    },

    // 关闭侧边栏
    close() {
        this.sidebar.classList.remove('open');
        this.overlay.classList.remove('open');
        document.body.style.overflow = '';
    },

    // 更新徽标数量
    updateBadge() {
        const records = this.getAll();
        const count = records.length;
        if (this.historyCountBadge) {
            this.historyCountBadge.textContent = count;
            this.historyCountBadge.style.display = count > 0 ? 'flex' : 'none';
        }
    },

    // 渲染历史列表
    render() {
        const records = this.getAll();

        if (records.length === 0) {
            this.historyList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>暂无检测记录</p>
                </div>`;
            return;
        }

        this.historyList.innerHTML = records.map(record => {
            const confidencePercent = Math.round((record.confidence || 0) * 100);
            return `
                <div class="history-item" data-id="${record.id}">
                    ${record.thumbnail
                        ? `<img src="${record.thumbnail}" alt="${record.fileName}" class="history-thumb">`
                        : `<div class="history-thumb" style="background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
                            <i class="fas fa-image"></i></div>`}
                    <div class="history-info">
                        <div class="history-result ${record.isAIGenerated ? 'ai' : 'real'}">
                            ${record.isAIGenerated ? '⚠ AI 生成' : '✓ 真实图片'}
                        </div>
                        <div class="history-confidence">
                            置信度: ${confidencePercent}%
                            (AI: ${Math.round((record.aiProbability || 0) * 100)}% /
                            真实: ${Math.round((record.realProbability || 0) * 100)}%)
                        </div>
                        <div class="history-date">${formatDate(record.timestamp)}</div>
                    </div>
                    <button class="btn-close" style="flex-shrink: 0;" data-delete="${record.id}">
                        <i class="fas fa-trash-alt" style="font-size: 0.8rem; color: var(--text-muted);"></i>
                    </button>
                </div>
            `;
        }).join('');

        // 绑定点击和删除事件
        this.historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不处理
                if (e.target.closest('[data-delete]')) return;
                showToast('点击历史记录可查看详情', 'info');
            });
        });

        this.historyList.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.delete;
                this.removeRecord(id);
            });
        });
    },

    // 更新徽标（导出给 app.js 调用）
    updateHistoryBadge() {
        this.updateBadge();
    }
};

// 全局兼容（app.js 中 loadHistory / updateHistoryBadge 指向这里）
function loadHistory() {
    History.updateBadge();
}

function updateHistoryBadge() {
    History.updateBadge();
}

document.addEventListener('DOMContentLoaded', () => {
    History.init();
    window.History = History;
});
