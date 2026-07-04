# AI 图片检测器

智能检测图片是否为 AI 生成的 Web 应用。上传图片，秒级获得检测结果。

## ✨ 功能特点

| 功能 | 说明 |
|------|------|
| 🔍 **智能检测** | 基于深度学习模型，准确判断图片是否为 AI 生成 |
| 📊 **可视化报告** | 直观的图表展示 AI 生成概率 vs 真实图片概率 |
| 📁 **多方式上传** | 支持选择文件、拖拽上传、粘贴 URL、拍照 |
| 🗂️ **批量检测** | 一次上传多张图片，自动批量检测 |
| 📜 **历史记录** | 自动保存检测历史，方便回溯查看 |
| 🌓 **深色模式** | 支持亮色/暗色主题切换 |
| 📱 **响应式设计** | 完美适配电脑、平板、手机 |
| 📥 **报告导出** | 下载检测报告为文本文件 |
| 📤 **一键分享** | 复制或分享检测结果 |

## 🚀 快速开始

### 前置条件

- Python 3.8+
- （可选）Hugging Face API Token（免费注册获取）

### 1. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 配置 API Token（可选）

编辑 `backend/.env` 文件，填入你的 Hugging Face Token：

```
HUGGINGFACE_API_KEY=hf_你的Token
```

> 不配置 Token 也能运行，但会使用模拟检测。

### 3. 启动服务

```bash
python backend/app.py
```

服务运行在 `http://127.0.0.1:5000`，Flask 会自动返回前端页面，直接打开浏览器访问即可。

## 🌐 部署到 Render（免费）

> 部署后任何人都能通过 URL 访问，无需你的电脑在线。

### 1. 在 GitHub 创建仓库并推送代码

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

### 2. 在 Render 创建 Web Service

1. 访问 [dashboard.render.com](https://dashboard.render.com) 并登录
2. 点击 **New +** → **Web Service**
3. 选择你的 GitHub 仓库，点击 **Connect**
4. 填写配置：
   - **Name**: `ai-image-detector`（或其他名称）
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `python backend/app.py`
5. 点击 **Create Web Service**

### 3. 配置环境变量（可选）

如果你要使用真实的 Hugging Face 检测模型：

1. 在 Render 控制台，进入你的服务 → **Environment** 标签
2. 添加变量：
   - `Key`: `HUGGINGFACE_API_KEY`
   - `Value`: 你的 Hugging Face Token（从 [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) 获取）
3. 点击 **Save Changes**，服务会自动重新部署

### 4. 访问应用

部署完成后，Render 会提供一个类似 `https://ai-image-detector.onrender.com` 的 URL，任何人（包括手机浏览器）都能访问。

> 免费套餐在 15 分钟无访问后会进入休眠，首次访问可能需要等待 30 秒左右唤醒。

## 📁 项目结构

```
AI检测/
├── frontend/              # 前端
│   ├── index.html         # 主页面
│   ├── css/
│   │   └── style.css      # 样式
│   └── js/
│       ├── app.js         # 应用核心（主题、状态、工具函数）
│       ├── upload.js      # 上传模块（文件、拖拽、URL、拍照）
│       ├── detect.js      # 检测模块（API 调用、结果渲染）
│       ├── history.js     # 历史记录（localStorage 存储）
│       └── batch.js       # 批量检测 + 报告导出
├── backend/               # 后端
│   ├── app.py             # Flask API 服务
│   ├── requirements.txt   # Python 依赖
│   └── .env               # 环境变量配置
└── README.md
```

## 🔧 API 接口

### 单张检测

```
POST /api/detect
Content-Type: multipart/form-data

file: <图片文件>
```

### 批量检测

```
POST /api/detect/batch
Content-Type: multipart/form-data

files: <多张图片文件>
```

### 健康检查

```
GET /api/health
```

## ❓ FAQ

**Q: 不配置 Token 能用吗？**

A: 可以。未配置 Token 时，后端会自动使用**模拟检测**作为降级方案。

**Q: 如何获取 Hugging Face Token？**

A: 访问 [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)，注册后创建 Token（免费）。

**Q: 检测准确吗？**

A: 检测结果仅供参考，不同模型准确率不同。建议结合多种方式综合判断。

## 📄 免责声明

本工具仅供学习研究使用，检测结果不构成专业意见，不对检测准确性负责。

## 📝 License

MIT
