from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from io import BytesIO
from PIL import Image
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app)

# 配置
MODEL_NAME = 'dima806/ai_vs_real_image_detection'
MAX_IMAGE_SIZE = (1024, 1024)
JPEG_QUALITY = 85

# 前端静态文件目录
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')

# 全局分类器（惰性加载，首次使用时初始化）
_classifier = None


def get_classifier():
    """惰性加载 AI 检测模型到内存中"""
    global _classifier
    if _classifier is None:
        print("🔄 正在加载 AI 检测模型，首次加载需要 1-2 分钟...")
        from transformers import pipeline
        import torch

        # 限制 CPU 线程数以减少内存占用
        torch.set_num_threads(1)

        _classifier = pipeline("image-classification", model=MODEL_NAME)
        print("✅ 模型加载完成！")
    return _classifier


@app.route('/')
def index():
    """返回前端页面"""
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """返回静态文件（CSS/JS/图片等）"""
    return send_from_directory(FRONTEND_DIR, filename)


@app.route('/api/detect', methods=['POST'])
def detect_image():
    """检测单张图片"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': '文件名为空'}), 400

    try:
        result = process_and_detect(file)
        return jsonify(result)

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'isAIGenerated': False,
            'confidence': 0,
            'aiProbability': 0,
            'realProbability': 0
        }), 500


@app.route('/api/detect/batch', methods=['POST'])
def detect_batch():
    """批量检测"""
    if 'files' not in request.files:
        return jsonify({'success': False, 'error': '没有上传文件'}), 400

    files = request.files.getlist('files')
    if not files:
        return jsonify({'success': False, 'error': '文件列表为空'}), 400

    results = []
    for file in files:
        try:
            result = process_and_detect(file)
            results.append(result)
        except Exception as e:
            results.append({
                'success': False,
                'error': str(e),
                'isAIGenerated': False,
                'confidence': 0,
                'aiProbability': 0,
                'realProbability': 0
            })

    return jsonify({'results': results})


@app.route('/api/health')
def health_check():
    """健康检查"""
    return jsonify({
        'status': 'healthy',
        'model': MODEL_NAME,
        'inference': 'local'
    })


def process_and_detect(file):
    """处理图片并检测"""
    # 1. 打开图片
    image = Image.open(file)

    # 2. 压缩图片（限制尺寸）
    if image.size[0] > MAX_IMAGE_SIZE[0] or image.size[1] > MAX_IMAGE_SIZE[1]:
        image.thumbnail(MAX_IMAGE_SIZE)

    # 3. 统一转 RGB 并输出为 JPEG 二进制
    buffer = BytesIO()
    if image.mode in ('RGBA', 'P'):
        image = image.convert('RGB')
    image.save(buffer, format='JPEG', quality=JPEG_QUALITY)
    image_bytes = buffer.getvalue()

    # 4. 使用本地模型检测
    return local_model_detect(image_bytes)


def local_model_detect(image_bytes):
    """使用本地 AI 模型进行推理"""
    try:
        image = Image.open(BytesIO(image_bytes))
        classifier = get_classifier()
        api_result = classifier(image)
        print(f"📦 本地模型推理结果: {api_result}")
        return parse_api_result(api_result)

    except Exception as e:
        return {
            'success': False,
            'error': f'模型推理失败: {str(e)}',
            'isAIGenerated': False,
            'confidence': 0,
            'aiProbability': 0,
            'realProbability': 0
        }


def parse_api_result(api_result):
    """解析模型返回结果"""
    ai_prob = 0
    real_prob = 0

    print(f"🔍 开始解析结果: {api_result}")

    if isinstance(api_result, list):
        for item in api_result:
            label = item.get('label', '').lower()
            score = item.get('score', 0)
            print(f"  - 标签: '{label}', 分数: {score}")

            # 常见标签模式
            if 'ai' in label or 'fake' in label or 'generated' in label or 'artificial' in label:
                ai_prob = score
                print(f"    → 识别为 AI 概率: {score}")
            elif 'real' in label or 'human' in label or 'natural' in label or 'authentic' in label:
                real_prob = score
                print(f"    → 识别为真实概率: {score}")
            elif label == 'label_0' or label == 'LABEL_0':
                ai_prob = score
                print(f"    → LABEL_0 识别为 AI 概率: {score}")
            elif label == 'label_1' or label == 'LABEL_1':
                real_prob = score
                print(f"    → LABEL_1 识别为真实概率: {score}")

    print(f"📊 解析结果: AI概率={ai_prob}, 真实概率={real_prob}")

    # 归一化
    total = ai_prob + real_prob
    if total > 0:
        ai_prob = ai_prob / total
        real_prob = real_prob / total
    else:
        # 如果解析不到，给个默认值
        ai_prob = 0.5
        real_prob = 0.5

    print(f"📈 归一化后: AI概率={ai_prob}, 真实概率={real_prob}")

    is_ai = ai_prob > 0.5

    return {
        'success': True,
        'isAIGenerated': is_ai,
        'confidence': max(ai_prob, real_prob),
        'aiProbability': ai_prob,
        'realProbability': real_prob,
        'details': {
            'model': MODEL_NAME,
            'rawResult': api_result
        }
    }


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    print(f"""
╔══════════════════════════════════════════╗
║     AI 图片检测器 - 后端服务             ║
║     运行地址: http://0.0.0.0:{port}   ║
╠══════════════════════════════════════════╣
║     检测模式: 本地模型推理 🔬            ║
║     使用模型: {MODEL_NAME}              ║
╚══════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=port, debug=debug)
