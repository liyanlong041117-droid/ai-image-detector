/**
 * upload.js - 上传功能模块
 * 处理文件选择、拖拽、URL 获取、拍照
 */

// 获取 DOM 引用（确保 app.js 已加载）
const Upload = {
    fileInput: null,
    uploadArea: null,
    urlInput: null,
    fetchUrlBtn: null,
    captureBtn: null,
    stopCameraBtn: null,
    clearSelectionBtn: null,
    batchHint: null,
    selectedCount: null,

    init() {
        this.fileInput = document.getElementById('fileInput');
        this.uploadArea = document.getElementById('uploadArea');
        this.urlInput = document.getElementById('urlInput');
        this.fetchUrlBtn = document.getElementById('fetchUrlBtn');
        this.captureBtn = document.getElementById('captureBtn');
        this.stopCameraBtn = document.getElementById('stopCameraBtn');
        this.clearSelectionBtn = document.getElementById('clearSelectionBtn');
        this.batchHint = document.getElementById('batchHint');
        this.selectedCount = document.getElementById('selectedCount');

        this.initFileInput();
        this.initDragDrop();
        this.initUrlFetch();
        this.initCamera();
        this.initClearBtn();
    },

    // 文件选择
    initFileInput() {
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                this.addFiles(Array.from(e.target.files));
            }
            // 重置 input，允许重复选择同一文件
            this.fileInput.value = '';
        });

        // 点击上传区域触发文件选择
        this.uploadArea.addEventListener('click', (e) => {
            if (APP_STATE.currentUploadMethod === 'file') {
                this.fileInput.click();
            }
        });
    },

    // 拖拽上传
    initDragDrop() {
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.uploadArea.classList.add('dragover');
        });

        this.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.uploadArea.classList.remove('dragover');

            if (e.dataTransfer.files.length) {
                this.addFiles(Array.from(e.dataTransfer.files));
            }
        });
    },

    // 添加文件
    addFiles(files) {
        const validFiles = files.filter(f => validateFile(f));

        if (validFiles.length === 0) {
            return;
        }

        // 去重（按文件名和大小）
        validFiles.forEach(file => {
            const exists = APP_STATE.selectedFiles.some(
                f => f.name === file.name && f.size === file.size
            );
            if (!exists) {
                APP_STATE.selectedFiles.push(file);
            }
        });

        this.updateBatchHint();
        this.renderPreviews();
    },

    // 移除文件
    removeFile(index) {
        APP_STATE.selectedFiles.splice(index, 1);
        this.updateBatchHint();
        this.renderPreviews();

        if (APP_STATE.selectedFiles.length === 0) {
            showUploadSection();
        }
    },

    // 更新批量提示
    updateBatchHint() {
        if (APP_STATE.selectedFiles.length > 1) {
            this.batchHint.classList.add('show');
            this.selectedCount.textContent = APP_STATE.selectedFiles.length;
        } else if (APP_STATE.selectedFiles.length === 1) {
            this.batchHint.classList.add('show');
            this.selectedCount.textContent = '1';
        } else {
            this.batchHint.classList.remove('show');
        }
    },

    // 渲染预览
    renderPreviews() {
        const grid = document.getElementById('previewGrid');

        if (APP_STATE.selectedFiles.length === 0) {
            grid.innerHTML = '';
            return;
        }

        grid.innerHTML = APP_STATE.selectedFiles.map((file, index) => {
            const url = URL.createObjectURL(file);
            return `
                <div class="preview-item">
                    <img src="${url}" alt="${file.name}" loading="lazy">
                    <button class="remove-btn" data-index="${index}" title="移除">
                        <i class="fas fa-times"></i>
                    </button>
                    <div class="file-name">${file.name}</div>
                </div>
            `;
        }).join('');

        // 绑定移除按钮事件
        grid.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.removeFile(index);
            });
        });

        // 显示预览区域
        if (APP_STATE.selectedFiles.length > 0) {
            showPreviewSection();
        }
    },

    // URL 获取图片
    initUrlFetch() {
        this.fetchUrlBtn.addEventListener('click', () => {
            const url = this.urlInput.value.trim();
            if (!url) {
                showToast('请输入图片 URL', 'warning');
                return;
            }

            showLoading('正在获取图片...');

            fetch(url)
                .then(res => {
                    if (!res.ok) throw new Error('无法获取图片');
                    return res.blob();
                })
                .then(blob => {
                    // 生成文件名
                    const ext = blob.type.split('/')[1] || 'jpg';
                    const file = new File([blob], `url-image.${ext}`, { type: blob.type });
                    this.addFiles([file]);
                    this.urlInput.value = '';
                    hideLoading();
                })
                .catch(err => {
                    hideLoading();
                    showToast('获取图片失败: ' + err.message, 'error');
                });
        });

        // 回车获取
        this.urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.fetchUrlBtn.click();
            }
        });
    },

    // 拍照
    initCamera() {
        this.captureBtn.addEventListener('click', () => {
            const video = document.getElementById('cameraVideo');
            const canvas = document.getElementById('cameraCanvas');

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            canvas.toBlob(blob => {
                const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
                this.addFiles([file]);
                stopCamera();
                document.getElementById('cameraArea').style.display = 'none';
                document.querySelector('.upload-option[data-method="file"]').click();
            }, 'image/jpeg', 0.9);
        });

        this.stopCameraBtn.addEventListener('click', () => {
            stopCamera();
            document.getElementById('cameraArea').style.display = 'none';
            document.querySelector('.upload-option[data-method="file"]').click();
        });
    },

    // 清空选择
    initClearBtn() {
        this.clearSelectionBtn.addEventListener('click', () => {
            APP_STATE.selectedFiles = [];
            this.updateBatchHint();
            this.renderPreviews();
            showUploadSection();
            showToast('已清空所有图片', 'info');
        });
    },

    // 继续添加按钮
    initAddMoreBtn() {
        const addMoreBtn = document.getElementById('addMoreBtn');
        if (addMoreBtn) {
            addMoreBtn.addEventListener('click', () => {
                showUploadSection();
                document.getElementById('uploadSection').scrollIntoView({ behavior: 'smooth' });
            });
        }
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    Upload.init();
    Upload.initAddMoreBtn();
});

// 暴露到全局
window.Upload = Upload;
