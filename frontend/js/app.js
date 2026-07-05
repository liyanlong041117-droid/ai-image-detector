/**
 * app.js - 主应用逻辑
 * 初始化、主题切换、Toast 通知、全局状态管理
 */

// ===== 全局配置 =====
const CONFIG = {
    // 后端 API 地址（指向 Render 部署的服务）
    API_BASE_URL: 'https://ai-image-detector-u376.onrender.com',
    // 最大文件大小（10MB）
    MAX_FILE_SIZE: 10 * 1024 * 1024,
    // 支持的文件类型
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
};

// ===== 全局状态 =====
const APP_STATE = {
    selectedFiles: [],         // 已选择的文件列表
    detectionResults: [],      // 检测结果列表
    currentUploadMethod: 'file', // 当前上传方式
    isDarkTheme: false,
    cameraStream: null,
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initUploadOptions();
    loadHistory();
    updateHistoryBadge();
    initGlobalListeners();
});

// ===== 主题切换 =====
function initTheme() {
    const savedTheme = localStorage.getItem('ai-detector-theme');
    if (savedTheme === 'dark') {
        APP_STATE.isDarkTheme = true;
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('themeBtn').innerHTML = '<i class="fas fa-sun"></i>';
    }
}

document.getElementById('themeBtn')?.addEventListener('click', () => {
    APP_STATE.isDarkTheme = !APP_STATE.isDarkTheme;
    const themeBtn = document.getElementById('themeBtn');

    if (APP_STATE.isDarkTheme) {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeBtn.innerHTML = '<i class="fas fa-sun"></i>';
        localStorage.setItem('ai-detector-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        themeBtn.innerHTML = '<i class="fas fa-moon"></i>';
        localStorage.setItem('ai-detector-theme', 'light');
    }
});

// ===== 上传方式切换 =====
function initUploadOptions() {
    const options = document.querySelectorAll('.upload-option');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            const method = opt.dataset.method;
            APP_STATE.currentUploadMethod = method;

            // 切换上传区域显示
            const uploadArea = document.getElementById('uploadArea');
            const urlArea = document.getElementById('urlInputArea');
            const cameraArea = document.getElementById('cameraArea');

            uploadArea.style.display = method === 'file' ? 'block' : 'none';
            urlArea.style.display = method === 'url' ? 'block' : 'none';

            if (method === 'camera') {
                cameraArea.style.display = 'block';
                initCamera();
            } else {
                cameraArea.style.display = 'none';
                stopCamera();
            }
        });
    });
}

// ===== Toast 通知 =====
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '<i class="fas fa-check-circle"></i>',
        error: '<i class="fas fa-times-circle"></i>',
        warning: '<i class="fas fa-exclamation-triangle"></i>',
        info: '<i class="fas fa-info-circle"></i>',
    };

    toast.innerHTML = `${icons[type] || icons.info} ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, duration);
}

// ===== 加载动画 =====
function showLoading(text = '正在检测中...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const progressBar = document.getElementById('progressBar');

    loadingText.innerHTML = text;
    progressBar.style.width = '10%';
    overlay.style.display = 'flex';

    // 模拟进度条
    let progress = 10;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) {
            progress = 90;
            clearInterval(progressInterval);
        }
        progressBar.style.width = progress + '%';
    }, 300);

    overlay._progressInterval = progressInterval;
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay._progressInterval) {
        clearInterval(overlay._progressInterval);
    }

    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = '100%';

    setTimeout(() => {
        overlay.style.display = 'none';
        progressBar.style.width = '10%';
    }, 200);
}

// ===== 辅助函数 =====
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    if (y === now.getFullYear()) {
        return `${m}-${d} ${h}:${min}`;
    }
    return `${y}-${m}-${d} ${h}:${min}`;
}

function validateFile(file) {
    if (!CONFIG.ALLOWED_TYPES.includes(file.type)) {
        showToast(`不支持的格式: ${file.name}，请上传 JPG/PNG/WebP 图片`, 'error');
        return false;
    }
    if (file.size > CONFIG.MAX_FILE_SIZE) {
        showToast(`文件过大: ${file.name}，最大支持 10MB`, 'error');
        return false;
    }
    return true;
}

// ===== 全局事件监听 =====
function initGlobalListeners() {
    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        // Esc 关闭侧边栏
        if (e.key === 'Escape') {
            closeHistory();
            stopCamera();
        }
    });
}

// ===== 页面切换辅助 =====
function showUploadSection() {
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'none';
}

function showPreviewSection() {
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('previewSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
    document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
}

function showResultSection() {
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'block';
    document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
}

// ===== 摄像头 =====
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        APP_STATE.cameraStream = stream;
        const video = document.getElementById('cameraVideo');
        video.srcObject = stream;
    } catch (err) {
        showToast('无法访问摄像头: ' + err.message, 'error');
        document.getElementById('cameraArea').style.display = 'none';
    }
}

function stopCamera() {
    if (APP_STATE.cameraStream) {
        APP_STATE.cameraStream.getTracks().forEach(track => track.stop());
        APP_STATE.cameraStream = null;
    }
}

// 导出供其他模块使用
window.CONFIG = CONFIG;
window.APP_STATE = APP_STATE;
window.showToast = showToast;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.formatFileSize = formatFileSize;
window.formatDate = formatDate;
window.validateFile = validateFile;
window.showUploadSection = showUploadSection;
window.showPreviewSection = showPreviewSection;
window.showResultSection = showResultSection;
